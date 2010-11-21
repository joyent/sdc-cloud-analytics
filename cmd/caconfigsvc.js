/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters and aggregators.
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');
var mod_cahttp = require('./caconfig/http');
var mod_log = require('ca-log');
var HTTP = require('http-constants');

var cfg_name = 'configsvc';	/* component name */
var cfg_vers = '0.0';		/* component version */
var cfg_http_port = 23181;	/* HTTP port for API endpoint */

var cfg_aggregators = {};	/* all aggregators, by hostname */
var cfg_instrumenters = {};	/* all instrumenters, by hostname */
var cfg_statmods = {};		/* describes available metrics and which */
				/* instrumenters provide them. */

var cfg_http;			/* http interface handle */
var cfg_cap;			/* camqp CAP wrapper */
var cfg_log;			/* log handle */

function main()
{
	var http_port = cfg_http_port;
	var broker = mod_ca.ca_amqp_default_broker;
	var sysinfo = mod_ca.caSysinfo(cfg_name, cfg_vers);
	var hostname = sysinfo.ca_hostname;
	var amqp;

	cfg_log = new mod_log.caLog({ out: process.stdout });

	amqp = new mod_caamqp.caAmqp({
		broker: broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_config,
		hostname: hostname,
		bindings: [ mod_ca.ca_amqp_key_config ]
	});
	amqp.on('amqp-error', mod_caamqp.caAmqpLogError(cfg_log));
	amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError(cfg_log));

	cfg_cap = new mod_cap.capAmqpCap({
	    amqp: amqp,
	    log: cfg_log,
	    sysinfo: sysinfo
	});
	cfg_cap.on('msg-cmd-ping', cfgCmdPing);
	cfg_cap.on('msg-cmd-status', cfgCmdStatus);
	cfg_cap.on('msg-notify-aggregator_online', cfgNotifyAggregatorOnline);
	cfg_cap.on('msg-notify-instrumenter_online',
	    cfgNotifyInstrumenterOnline);
	cfg_cap.on('msg-notify-log', cfgNotifyLog);
	cfg_cap.on('msg-notify-instrumenter_error', cfgNotifyInstrumenterError);
	cfg_cap.on('msg-ack-enable_instrumentation', cfgAckEnable);
	cfg_cap.on('msg-ack-disable_instrumentation', cfgAckDisable);
	cfg_cap.on('msg-ack-enable_aggregation', cfgAckEnableAgg);

	cfg_http = new mod_cahttp.caConfigHttp({
	    log: cfg_log, port: http_port
	});
	cfg_http.on('inst-create', cfgCreateInstrumentation);
	cfg_http.on('inst-delete', cfgDeleteInstrumentation);
	cfg_http.on('list-metrics', cfgListMetrics);

	cfg_log.info('Config service starting up (%s/%s)', cfg_name, cfg_vers);
	cfg_log.info('%-12s %s', 'Hostname:', hostname);
	cfg_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(broker));
	cfg_log.info('%-12s %s', 'Routing key:', amqp.routekey());
	cfg_log.info('%-12s Port %d', 'HTTP server:', http_port);

	amqp.start(function () {
		cfg_log.info('AMQP broker connected.');
	});

	cfg_http.start(function () {
		cfg_log.info('HTTP server started.');
	});
}

var cfg_inst_id = 1;
var cfg_insts = {};

function cfgCreateInstrumentation(args, callback)
{
	var id, key;
	var mincount, minkey;
	var instspec = args['spec'];
	var statkey, ninsts;
	var check = function (obj, field, type, required) {
		if (required && !obj[field])
			throw (new Error('missing required field: ' + field));

		if (!obj[field])
			return;

		if (typeof (type) != typeof (obj[field]))
			throw (new Error('wrong type for field: ' + field));
	};

	check(instspec, 'module', '', true);
	check(instspec, 'stat', '', true);
	check(instspec, 'nodes', [], false);
	check(instspec, 'predicate', [], false);
	check(instspec, 'decomposition', [], false);

	if (!instspec['predicate'])
		instspec['predicate'] = [];

	if (!instspec['decomposition'])
		instspec['decomposition'] = [];

	/*
	 * Pick *one* aggregator and have it collect data for this.  This
	 * algorithm could be smarter.  We currently just compare the number of
	 * stats an aggregator is already aggregating.  We should also try other
	 * ones if the one we pick seems down.
	 */
	for (key in cfg_aggregators) {
		if (mincount === undefined ||
		    cfg_aggregators[key].cag_ninsts < mincount) {
			mincount = cfg_aggregators[key].cag_ninsts;
			minkey = key;
		}
	}

	if (mincount === undefined) {
		callback(HTTP.ESERVER, 'no aggregators available');
		return;
	}

	id = cfg_inst_id++;  /* XXX should be unique across time. */
	statkey = mod_ca.caKeyForInst(id);

	cfg_cap.send(cfg_aggregators[minkey].cag_routekey, {
	    ca_id: id,
	    ca_type: 'cmd',
	    ca_subtype: 'enable_aggregation',
	    ag_inst_id: id,
	    ag_key: statkey
	});

	/*
	 * XXX filter these based on 'nodes'
	 */
	ninsts = 0;
	for (key in cfg_instrumenters) {
		ninsts++;
		cfg_cap.send(cfg_instrumenters[key].ins_routekey, {
		    ca_id: id,
		    ca_type: 'cmd',
		    ca_subtype: 'enable_instrumentation',
		    is_inst_key: statkey,
		    is_inst_id: id,
		    is_module: instspec['module'],
		    is_stat: instspec['stat'],
		    is_predicate: instspec['predicate'],
		    is_decomposition: instspec['decomposition']
		});
		cfg_instrumenters[key].ins_ninsts++;
	}

	cfg_insts[id] = {
	    agg_result: undefined,
	    insts_failed: 0,
	    insts_ok: 0,
	    insts_total: ninsts,
	    callback: callback
	};

	/* XXX timeout HTTP request */
}

function cfgDeleteInstrumentation(args, callback)
{
	var key;

	if (!(args['instid'] in cfg_insts)) {
		callback(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	delete (cfg_insts[args['instid']]);
	callback(HTTP.OK);

	/*
	 * XXX filter these based on 'nodes'
	 */
	for (key in cfg_instrumenters) {
		cfg_instrumenters[key].ins_ninsts--;
		cfg_cap.send(cfg_instrumenters[key].ins_routekey, {
		    ca_type: 'cmd',
		    ca_subtype: 'disable_instrumentation',
		    ca_id: args['instid'],
		    is_inst_id: args['instid']
		});
	}
}

function cfgListMetrics(callback)
{
	callback(HTTP.OK, cfg_statmods);
}

function cfgCheckNewInstrumentation(id)
{
	var inst = cfg_insts[id];
	var callback = inst.callback;

	if (inst.agg_done === undefined ||
	    inst.insts_failed + inst.insts_ok < inst.insts_total)
		return;

	if (inst.agg_done === false) {
		/* XXX could try another aggregator. */
		callback(HTTP.ESERVER, 'error: failed to enable aggregator');
		return;
	}

	if (inst.insts_failed > 0) {
		callback(HTTP.ESERVER,
		    'error: failed to enable some instrumenters');
		return;
	}

	callback(HTTP.CREATED, { id: id });
}

function cfgAckEnableAgg(msg)
{
	var id;

	if (!('ag_inst_id' in msg)) {
		cfg_log.warn('dropped ack-enable_aggregation message with ' +
		    'missing id');
		return;
	}

	id = msg.ag_inst_id;

	if (msg.ag_status != 'enabled') {
		cfg_insts[id].agg_done = false;
	} else {
		cfg_insts[id].agg_done = true;
	}

	cfgCheckNewInstrumentation(id);
}

function cfgAckEnable(msg)
{
	var id, result;

	if (!('is_inst_id' in msg)) {
		cfg_log.warn('dropped ack-enable_instrumentation message ' +
		    'with missing id');
		return;
	}

	id = msg.is_inst_id;
	result = msg.is_status;
	if (msg.is_status != 'enabled') {
		cfg_insts[id].insts_failed++;
		result += ' (' + msg.is_error + ')';
	} else {
		cfg_insts[id].insts_ok++;
	}

	cfg_log.info('host %s instrument %s: %s', msg.ca_hostname,
	    msg.is_inst_id, result);
	cfgCheckNewInstrumentation(id);
}

function cfgAckDisable(msg)
{
	var result;

	result = msg.is_status;
	if (msg.is_status != 'disabled')
		result += ' (' + msg.is_error + ')';

	cfg_log.info('host %s deinstrument %s: %s', msg.ca_hostname,
	    msg.is_inst_id, result);
}

function cfgCmdPing(msg)
{
	cfg_cap.send(msg.ca_source, cfg_cap.responseTemplate(msg));
}

function cfgCmdStatus(msg)
{
	var key, inst, agg;
	var sendmsg = cfg_cap.responseTemplate(msg);

	sendmsg.s_component = 'config';

	sendmsg.s_instrumenters = [];
	for (key in cfg_instrumenters) {
		inst = cfg_instrumenters[key];
		sendmsg.s_instrumenters.push({
		    sii_hostname: inst.ins_hostname,
		    sii_nmetrics_avail: inst.ins_nmetrics_avail,
		    sii_ninsts: inst.ins_ninsts
		});
	}

	sendmsg.s_aggregators = [];
	for (key in cfg_aggregators) {
		agg = cfg_aggregators[key];
		sendmsg.s_aggregators.push({
		    sia_hostname: agg.cag_hostname,
		    sia_ninsts: agg.cag_ninsts
		});
	}

	cfg_cap.send(msg.ca_source, sendmsg);
}

function cfgNotifyAggregatorOnline(msg)
{
	var agg = {};

	agg.cag_hostname = msg.ca_hostname;
	agg.cag_routekey = msg.ca_source;
	agg.cag_agent_name = msg.ca_agent_name;
	agg.cag_agent_version = msg.ca_agent_version;
	agg.cag_os_name = msg.ca_os_name;
	agg.cag_os_release = msg.ca_os_release;
	agg.cag_os_revision = msg.ca_os_revision;
	agg.cag_ninsts = 0;

	/* XXX if already exists, it restarted, so need to update its state! */
	cfg_aggregators[agg.cag_hostname] = agg;

	cfg_log.info('aggregator started: %s', msg.ca_hostname);
}

function cfgNotifyInstrumenterOnline(msg)
{
	var inst, action;
	var mod, mstats, stat, mfields, field;
	var mm, ss, ff;

	if (msg.ca_hostname in cfg_instrumenters) {
		inst = cfg_instrumenters[msg.ca_hostname];
		action = 'restarted';
	} else {
		inst = cfg_instrumenters[msg.ca_hostname] = {};
		action = 'started';
	}

	inst.ins_hostname = msg.ca_hostname;
	inst.ins_routekey = msg.ca_source;
	inst.ins_agent_name = msg.ca_agent_name;
	inst.ins_agent_version = msg.ca_agent_version;
	inst.ins_os_name = msg.ca_os_name;
	inst.ins_os_release = msg.ca_os_release;
	inst.ins_os_revision = msg.ca_os_revision;
	inst.ins_nmetrics_avail = 0;
	inst.ins_ninsts = 0;

	for (mm = 0; mm < msg.ca_modules.length; mm++) {
		mod = msg.ca_modules[mm];

		if (!(mod.cam_name in cfg_statmods)) {
			cfg_statmods[mod.cam_name] = {
				stats: {},
				label: mod.cam_description
			};
		}

		mstats = cfg_statmods[mod.cam_name]['stats'];
		inst.ins_nmetrics_avail += mod.cam_stats.length;

		for (ss = 0; ss < mod.cam_stats.length; ss++) {
			stat = mod.cam_stats[ss];
			if (!(stat.cas_name in mstats)) {
				mstats[stat.cas_name] = {
				    label: stat.cas_description,
				    type: stat.cas_type,
				    fields: {}
				};
			}

			mfields = mstats[stat.cas_name]['fields'];

			for (ff = 0; ff < stat.cas_fields.length; ff++) {
				field = stat.cas_fields[ff];

				if (!(field.caf_name in mfields)) {
					mfields[field.caf_name] = {
					    type: field.caf_type,
					    label: field.caf_description
					};
				}
			}
		}
	}

	/* XXX if already exists, it restarted, so need to update its state! */

	cfg_log.info('instrumenter %s: %s', action, msg.ca_hostname);
}

function cfgNotifyLog(msg)
{
	if (!('l_message' in msg)) {
		cfg_log.warn('dropped log message with missing message');
		return;
	}

	cfg_log.warn('from %s: %s %s', msg.ca_hostname, msg.ca_time,
	    msg.l_message);
}

function cfgNotifyInstrumenterError(msg)
{
	if (!('ins_inst_id' in msg) || !('ins_error' in msg) ||
	    !('ins_status' in msg) ||
	    (msg['status'] != 'enabled' && msg['status'] != 'disabled')) {
		cfg_log.warn('dropping malformed inst error message');
		return;
	}

	if (!(msg.ca_hostname in cfg_instrumenters)) {
		cfg_log.warn('dropping inst error message for unknown host ' +
		    '"%s"', msg.ca_hostname);
		return;
	}

	/* XXX */
}

main();
