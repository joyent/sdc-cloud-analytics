/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_ca = require('../../../lib/ca/ca-common');
var mod_dtrace = require('libdtrace');
var mod_capred = require('../../../lib/ca/ca-pred');
var mod_sys = require('sys');
var ASSERT = require('assert');

var insd_log;

exports.insinit = function (ins, log)
{
	insd_log = log;
	ins.registerModule({ name: 'syscall', label: 'System calls' });
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'ops',
	    label: 'syscalls',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		syscall: { label: 'system call', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'numeric' }
	    },
	    metric: insdSyscalls
	});

	ins.registerModule({ name: 'io', label: 'Disk I/O' });
	ins.registerMetric({
	    module: 'io',
	    stat: 'ops',
	    label: 'operations',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		optype: { label: 'type', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'numeric' }
	    },
	    metric: insdIops
	});

	ins.registerModule({ name: 'node', label: 'Node.js' });
	ins.registerMetric({
	    module: 'node',
	    stat: 'httpd',
	    label: 'HTTP server operations',
	    type: 'ops',
	    fields: {
		method: { label: 'method', type: 'string' },
		url: { label: 'URL', type: 'string' },
		raddr: { label: 'remote address', type: 'string' },
		rport: { label: 'remote port', type: 'string' },
		latency: { label: 'latency', type: 'numeric' }
	    },
	    metric: insdNodeHttpd
	});

};

var insdFields = {
	hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
	zonename: 'zonename',
	syscall: 'probefunc',
	execname: 'execname',
	optype: '(args[0]->b_flags & B_READ ? "read" : "write")'
};

/*
 * A utility to create the probe-specific insdFields object
 */
function insFieldsCreate(obj)
{
	var copy = mod_ca.caDeepCopy(insdFields);
	mod_ca.caDeepCopyInto(copy, obj);
	return (copy);
}

function insdMakePredicate(predicates)
{
	if (predicates.length === 0)
		return ('');

	return ('/' + predicates.map(function (elt) {
	    return ('(' + elt + ')');
	}).join(' &&\n') + '/\n');
}

function insdSyscalls(metric)
{
	var decomps = metric.is_decomposition;
	var hasPredicate = false;
	var aggLatency = false;
	var traceLatency = false;
	var script = '';
	var action, predicates, zones, indexes, index, zero, ii, pred;

	predicates = [];

	hasPredicate = mod_capred.caPredNonTrivial(metric.is_predicate);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			traceLatency = true;
			aggLatency = true;
			continue;
		}

		ASSERT.ok(decomps[ii] in insdFields);
		indexes.push(insdFields[decomps[ii]]);
	}

	if (mod_capred.caPredContainsField('latency', metric.is_predicate))
		traceLatency = true;

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	if (traceLatency) {
		script += 'syscall:::entry\n' +
		    insdMakePredicate(predicates) +
		    '{\n' +
		    '\tself->ts = timestamp;\n' +
		    '}\n\n';
		predicates = [ 'self->ts' ];
	}

	if (aggLatency) {
		action = 'lquantize(timestamp - self->ts, 0, 100000, 100);';
	} else {
		action = 'count();';
	}

	if (hasPredicate) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(insFieldsCreate({
		    latency: '(timestamp - self->ts)'
		}), pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}


	script += 'syscall:::return\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);

	script += '}\n';

	if (traceLatency) {
		script += '\nsyscall:::return\n';
		script += '{\n';

		script += '\tself->ts = 0;\n';

		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero));
}

function insdIops(metric)
{
	var decomps = metric.is_decomposition;
	var script = '';
	var ii, predicates, zones, indexes, zero, index;
	var fields, before, hasPredicate, pred;
	var aggLatency, action;

	predicates = [];
	before = [];

	hasPredicate = mod_capred.caPredNonTrivial(metric.is_predicate);
	fields = mod_capred.caPredFields(metric.is_predicate);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));

		if (!mod_ca.caArrayContains(fields, 'zonename'))
			fields.push('zonename');
	}

	/*
	 * The indexes variable is being used to determine how we aggregate the
	 * data ultimately where as the fields, determine which data we need to
	 * store during the entry probe
	 */
	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			aggLatency = true;
			if (!mod_ca.caArrayContains(fields, decomps[ii]))
				fields.push(decomps[ii]);
			decomps.splice(ii--, 1);
			continue;
		}

		ASSERT.ok(decomps[ii] in insdFields);
		if (!mod_ca.caArrayContains(fields, decomps[ii]))
			fields.push(decomps[ii]);

		indexes.push(insdFields[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + decomps.map(function (elt) {
			return (elt + 's[arg0]');
		}).join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] != 'latency' && fields[ii] != 'optype')
			before.push(fields[ii]);
	}

	if (aggLatency || before.length > 0) {
		script += 'io:::start\n';
		script += '{\n';

		if (mod_ca.caArrayContains(fields, 'latency'))
			script += '\tlatencys[arg0] = timestamp;\n';

		for (ii = 0; ii < before.length; ii++)
			script += mod_ca.caSprintf('\t%ss[arg0] = %s;\n',
			    before[ii], insdFields[before[ii]]);

		script += '}\n\n';
	}

	if (aggLatency) {
		action = 'lquantize(timestamp - latencys[arg0]' +
		    ', 0, 1000000, 1000);';
		predicates.push('latencys[arg0]');
	} else if (indexes.length > 0) {
		action = 'count();';
		predicates.push(mod_ca.caSprintf('%ss[arg0] != NULL',
		    decomps[0]));
	} else {
		action = 'count();';
	}

	if (hasPredicate) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields({
		    latency: '(timestamp - latencys[arg0])',
		    zonename: 'zonenames[arg0]',
		    hostname: 'hostnames[arg0]',
		    execname: 'execnames[arg0]',
		    optype: '(args[0]->b_flags & B_READ ? "read" : "write")'
		}, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'io:::done\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	script += 'io:::done\n';
	script += '{\n';

	for (ii = 0; ii < fields.length; ii++)
		script += mod_ca.caSprintf('\t%ss[arg0] = 0;\n', fields[ii]);

	script += '}\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero));
}

function insdNodeHttpd(metric)
{
	var decomps = metric.is_decomposition;
	var pred = metric.is_predicate;
	var script = '';
	var ii, predicates, hasPred, fields, zones, indexes, index;
	var before, zero, aggLatency, action;

	/*
	 * We divide latency by the same amount that we do during the quantize,
	 * so that that the values input by the user will be in the same unit as
	 * when visualized. Hopefully this will not be needed once we have some
	 * kind of equantize.
	 */
	var transforms = {
	    latency: '((timestamp - latencys[args[0]->fd]) / 1000000)',
	    method: '(methods[args[0]->fd])',
	    url: '(urls[args[0]->fd])',
	    raddr: '(args[0]->remoteAddress)',
	    rport: '(args[0]->remotePort)'
	};

	predicates = [];

	hasPred = mod_capred.caPredNonTrivial(pred);
	fields = mod_capred.caPredFields(pred);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			aggLatency = true;
			if (!mod_ca.caArrayContains(fields, decomps[ii]))
				fields.push(decomps[ii]);
			decomps.splice(ii--, 1);
			continue;
		}

		if (!mod_ca.caArrayContains(fields, decomps[ii]))
			fields.push(decomps[ii]);

		indexes.push(transforms[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	before = [];
	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] != 'raddr' && fields[ii] != 'rport')
			before.push(fields[ii]);
	}

	if (before.length > 0) {
		script += 'node*:::http-server-request\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++) {
			switch (before[ii]) {
			case 'latency':
				script += '\tlatencys[args[1]->fd] = ' +
				    'timestamp;\n';
				break;
			case 'method':
				script += '\tmethods[args[1]->fd] = ' +
				    'args[0]->method;\n';
				break;
			case 'url':
				script += '\turls[args[1]->fd] = ' +
				    'args[0]->url;\n';
				break;
			default:
				throw (new Error('invalid field for ' +
				    'node-httpd' + before[ii]));
			}
		}

		script += '}\n\n';
	}

	if (aggLatency) {
		action = 'lquantize((timestamp - latencys[args[0]->fd]) / ' +
		    '1000000, 0, 10000, 10);';
	} else {
		action = 'count();';
	}

	if (aggLatency) {
		predicates.push('latencys[args[0]->fd]');
	} else if (indexes.length > 0) {
		predicates.push(mod_ca.caSprintf('%ss[args[0]->fd] != NULL',
		    decomps[0]));
	}

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'node*:::http-server-response\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	if (before.length > 0) {
		script += 'node*:::http-server-response\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++)
			script += mod_ca.caSprintf('\t%ss[args[0]->fd] = 0;\n',
			    before[ii]);

		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero));
}

function insDTraceMetric(prog)
{
	this.cad_prog = prog;
}

insDTraceMetric.prototype.instrument = function (callback)
{
	var sep = '----------------------------------------';

	/*
	 * Only log the script on the first time through here.
	 */
	if (this.cad_dtr === undefined)
		insd_log.dbg('\n%s\n%s%s', sep, this.cad_prog, sep);

	this.cad_dtr = new mod_dtrace.Consumer();

	try {
		this.cad_dtr.strcompile(this.cad_prog);
		this.cad_dtr.go();

		if (callback)
			callback();
	} catch (ex) {
		insd_log.error('instrumentation failed; exception follows');
		insd_log.exception(ex);
		this.cad_dtr = null;
		if (callback)
			callback(ex);
	}
};

insDTraceMetric.prototype.deinstrument = function (callback)
{
	this.cad_dtr.stop();
	this.cad_dtr = null;

	if (callback)
		callback();
};

insDTraceMetric.prototype.value = function ()
{
	var agg = {};
	var iteragg = function (id, key, val) {
		if (!(id in agg))
			agg[id] = {};

		agg[id][key] = val;
	};

	/*
	 * If we failed to instrument, all we can do is return an error.
	 * Because the instrumenter won't call value() except after a successful
	 * instrument(), this can only happen if we successfully enable the
	 * instrumentation but DTrace aborts sometime later and we fail to
	 * reenable it.
	 */
	if (!this.cad_dtr)
		return (undefined);

	try {
		this.cad_dtr.aggwalk(iteragg);
	} catch (ex) {
		/*
		 * In some cases (such as simple drops), we could reasonably
		 * ignore this and drive on.  Or we could stop this consumer,
		 * increase the buffer size, and re-enable.  In some cases,
		 * though, the consumer has already aborted so we have to create
		 * a new handle and re-enable.  For now, we deal with all of
		 * these the same way: create a new handle and re-enable.
		 * XXX this should be reported to the configuration service as
		 * an asynchronous instrumenter error.
		 * XXX shouldn't all log entries be reported back to the
		 * configuration service for debugging?
		 */
		insd_log.error('re-enabling instrumentation due to error ' +
		    'reading aggregation. exception follows:');
		insd_log.exception(ex);
		this.instrument();
		return (undefined);
	}

	return (this.reduce(agg));
};

function insDTraceVectorMetric(prog, hasdecomps, zero)
{
	this.cadv_decomps = hasdecomps;
	this.cadv_zero = zero;
	insDTraceMetric.call(this, prog);
}

mod_sys.inherits(insDTraceVectorMetric, insDTraceMetric);

insDTraceVectorMetric.prototype.reduce = function (agg)
{
	var aggid;

	for (aggid in agg) {
		if (!this.cadv_decomps)
			return (agg[aggid]['']);

		return (agg[aggid]);
	}

	return (this.cadv_zero);
};
