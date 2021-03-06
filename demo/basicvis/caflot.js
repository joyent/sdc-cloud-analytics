/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * caflot.js: flot-based visualization of CA metrics for demo purposes.
 * Note that variables declared here may be overwritten by cademo.js via the
 * pseudo-file cavars.js (included after caflot.js in graph.htm).
 */

/*
 * Static configuration
 */
var gServer = window.location.hostname;
var gPort = 23181;		/* config service HTTP port */
var gPlotWidth = 600;		/* plot width (pixels) */
var gPlotHeight = 300;		/* plot height (pixels) */
var gnBuckets = 50;		/* vertical buckets (for heatmaps) */
var gZoomOptions = [ 10, 30, 60, 300, 600, 3600 ];	/* seconds */
var gZoomDefault = 1;		/* default is 30 seconds */
var gyMin = 0;			/* global/default ymin for heatmaps */
var gyMax = 10000000000;	/* global/default ymax for heatmaps 10s */

/*
 * Flot options
 */
var gScalarOptions = {
	series: { lines: { show: true, fill: true } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 },
	legend: { show: false },
	grid: { clickable: true }
};

var gVectorOptions = {
	series: { lines: { show: true, fill: 0.8, lineWidth: 0 } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 },
	legend: { position: 'nw' },
	grid: { clickable: true }
};

/*
 * Dynamic (server-side) configuration
 */
var gFields;			/* global field information */
var gTypes;			/* global type information */
var gMetrics;			/* all available metrics */

/*
 * Color management
 */
var gBaseColors = [ '#edc240', '#afd8f8', '#cb4b4b', '#4da74d', '#9440ed' ];
var gColors = [];
var gMaxSeries;

/*
 * Global state
 */
var gGraphs = {};		/* currently active graphs */
var gPersistCheckbox;

/*
 * Fix that Firefox < 4 doesn't have Object.keys(); -- Code from
 * developer.mozilla.org
 */
if (!Object.keys)
	Object.keys = function (o) {
		var ret = [], p;

		for (p in o) {
			if (Object.prototype.hasOwnProperty.call(o, p))
				ret.push(p);
		}

		return (ret);
	};

window.onload = function ()
{
	gPersistCheckbox = document.getElementById('gStatPersistent');

	gInitColors();
	gInitConfig();
	setTimeout(gTick, 0);
};

/*
 * Expand the base set of colors using simple variations.
 */
function gInitColors()
{
	var ii, jj, base, color, saturation;
	var saturations = [ 1.0, 0.5 ];

	for (ii = 0; ii < saturations.length; ii++) {
		for (jj = 0; jj < gBaseColors.length; jj++) {
			base = new gColor(gBaseColors[jj]);
			saturation = base.saturation() * saturations[ii];
			color = new gColor(
			    [ base.hue(), saturation, base.value() ], 'hsv');
			gColors.push(color);
		}
	}

	gMaxSeries = gColors.length - 1;
}

/*
 * Initialize our configuration of types, metrics, transformations, and such.
 */
function gInitConfig()
{
	var url, request;

	url = 'http://' + gServer + ':' + gPort + '/ca' + gCustUri();

	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load configuration');
			return;
		}

		gInitConfigDone(JSON.parse(request.responseText));
	};
}

function gInitConfigDone(config)
{
	var metric, option, label, modules;
	var elt, key, ii;

	gTypes = config['types'];
	gMetrics = config['metrics'];
	gFields = config['fields'];

	modules = {};
	for (key in config['modules'])
		modules[key] = config['modules'][key]['label'];

	elt = document.getElementById('gStatSelector');
	for (ii = 0; ii < gMetrics.length; ii++) {
		metric = gMetrics[ii];
		label = modules[metric['module']] + ': ' + metric['label'];
		metric.ca_label = label;

		option = elt.appendChild(document.createElement('option'));
		option.value = ii;
		option.appendChild(document.createTextNode(metric.ca_label));
	}

	if (gMetrics.length > 0) {
		gStatSelected();
		elt = document.getElementById('gStatAddButton');
		elt.disabled = false;
	}

	gInitInstrumentations();
}

/*
 * Now that we have the available metrics, retrieve and load graphs for
 * any preexisting instrumentations.
 */
function gInitInstrumentations()
{
	var url = 'http://' + gServer + ':' + gPort + '/ca' +
	    gCustUri() + '/instrumentations';
	var request = new XMLHttpRequest();

	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load instrumentation list');
			return;
		}

		gInitInstrumentationsFini(JSON.parse(request.responseText));
	};

}

function gInitInstrumentationsFini(instrumentations)
{
	var container, inst, metric, graph;
	var ii, jj;

	container = document.getElementById('gContainerDiv');

	for (ii = 0; ii < instrumentations.length; ii++) {
		inst = instrumentations[ii];

		for (jj = 0; jj < gMetrics.length; jj++) {
			metric = gMetrics[jj];
			if (metric.module == inst.module &&
			    metric.stat == inst.stat)
				break;
		}

		if (jj == gMetrics.length)
			continue;

		graph = new gGraph({
			metric: metric,
			decomps: inst.decomposition,
			predicate: inst.predicate,
			uri: inst.uri,
			uris: inst.uris
		});

		container.appendChild(graph.getContainer());
		gGraphs[graph.getId()] = graph;
	}
}

/*
 * Invoked once/second to update all of our graphs.
 */
function gTick()
{
	for (var id in gGraphs)
		gGraphs[id].refresh();

	setTimeout(gTick, 1000);
}

/*
 * Returns the arity of a given field by name.
 */
function gFieldToArity(fieldname)
{
	var field = gFields[fieldname];
	return (gTypes[field['type']]['arity']);
}

var gUnitPowers = [
	{ exp: -9, prefix: 'n' },
	{ exp: -6, prefix: 'u' },
	{ exp: -3, prefix: 'm' },
	{ exp:  0, prefix: ''  },
	{ exp:  3, prefix: 'K' },
	{ exp:  6, prefix: 'M' },
	{ exp:  9, prefix: 'G' },
	{ exp: 12, prefix: 'T' }
];

var gUnitBases = {
	2: 10,		/* base  2: each prefix is 2^10 */
	10: 3		/* base 10: each prefix is 10^3 */
};

/*
 * Given a type and a value, return an object with the following members
 * describing how to transform the value to a human-readable string:
 *
 *	divisor		how much to divide the value to get it in the new unit
 *
 *	label		the unit to display, including SI prefix if divisor is
 *			not 1
 */
function gTypeTransform(type, value)
{
	var power, ii, divisor;

	power = type['power'] || 0;

	for (ii = 0; ii < gUnitPowers.length; ii++) {
		if (gUnitPowers[ii]['exp'] == power)
			break;
	}

	if (ii == gUnitPowers.length)
		/* should be impossible if backend is behaving correctly */
		return ({ divisor: 1, label: '' });

	divisor = 1;
	while (ii < gUnitPowers.length - 1 && value / divisor >=
	    Math.pow(type['base'], gUnitBases[type['base']])) {
		divisor *= Math.pow(type['base'], gUnitBases[type['base']]);
		ii++;
	}

	return ({
	    divisor: divisor,
	    label: gUnitPowers[ii]['prefix'] +
		('abbr' in type ? type['abbr'] : (type['unit'] || ''))
	});
}

/*
 * Round a value up to 2 decimal places (for formatting).
 */
function gValueRound(value)
{
	return (Math.ceil(value * 100) / 100);
}

/*
 * Given a base metric and a value, return the best human-readable label for the
 * scalar quantity.
 */
function gMetricUnit(metric, value)
{
	var xform;

	if (!('type' in metric))
		return (value);

	xform = gTypeTransform(gTypes[metric['type']], value);
	return (gValueRound(value / xform['divisor']) + ' ' + xform['label']);
}

/*
 * Given a metric, return a label for the base unit.
 */
function gMetricBase(metric)
{
	if ('unit' in metric)
		return (metric['unit']);

	return (gTypes[metric['type']]['unit']);
}

/*
 * Returns the customer id of the currently active customer.  Currently, we just
 * store this in the browser URL's hash string.
 */
function gCustId()
{
	return (window.location.hash.substring(1));
}

/*
 * Given a customer id, return the customer-specific (scope) portion of URIs for
 * this customer's requests.  If the customer id is undefined, the global scope
 * is assumed.
 */
function gCustUri(custid)
{
	if (custid === undefined)
		custid = window.location.hash.substring(1);
	return (custid.length > 0 ? '/customers/' + custid : '');
}

/*
 * Identifies which metric and decomposition(s) are selected, creates the
 * corresponding instrumentation on the server, and adds a new graph to the UI.
 */
function gAddStat()
{
	var statsel, decompsel, decomp2sel;
	var statoption, decompoption, decomp2option;
	var metric, decomps, graph, preds;

	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	decompsel = document.getElementById('gDecompositionSelector');
	decompoption = decompsel.options[decompsel.selectedIndex];
	decomp2sel = document.getElementById('gDecompositionSelector2');
	decomp2option = decomp2sel.options[decomp2sel.selectedIndex];

	metric = gMetrics[statoption.value];
	decomps = [];
	preds = {};

	if (decompoption.value !== '')
		decomps.push(decompoption.value);

	if (decomp2option.value !== '')
		decomps.push(decomp2option.value);

	graph = new gGraph({
		metric: metric,
		decomps: decomps,
		predicate: preds,
		customer_id: gCustId() || undefined
	});

	gAppendGraph(graph);
}

/*
 * Delete the instrumentation for this graph and remove the graph from the UI.
 */
function gRemoveStat(graph)
{
	var div = graph.getContainer();

	div.parentNode.removeChild(div);
	delete (gGraphs[graph.getId()]);

	graph.serverDelete(function (err) {
		if (err)
			alert(err);
	});
}

/*
 * Invoked when the user selects a particular module/stat so we can populate the
 * decomposition selectors with the appropriate options.
 */
function gStatSelected()
{
	var statsel, decompsel, metric, fieldname, field, option;
	var ii;

	decompsel = document.getElementById('gDecompositionSelector');
	decompsel.disabled = false;
	while (decompsel.options.length > 0)
		decompsel.remove(decompsel.options[0]);

	statsel = document.getElementById('gStatSelector');
	option = statsel.options[statsel.selectedIndex];
	metric = gMetrics[option.value];

	option = decompsel.appendChild(document.createElement('option'));
	option.value = '';
	option.appendChild(document.createTextNode('<none>'));

	for (ii = 0; ii < metric['fields'].length; ii++) {
		fieldname = metric['fields'][ii];
		field = gFields[fieldname];

		option = decompsel.appendChild(
		    document.createElement('option'));
		option.value = fieldname;
		option.appendChild(document.createTextNode(field['label']));
	}

	decompsel.selectedIndex = 0;

	if (decompsel.options.length == 1)
		decompsel.disabled = true;

	gDecompSelected();
}

/*
 * Invoked when the user selects a particular decomposition so we can populate
 * the secondary decomposition selector.  We don't allow the user to decompose
 * by two fields with the same type.
 */
function gDecompSelected()
{
	var statsel, decompsel, decompsel2, metric;
	var statoption, firstoption, option;
	var fieldname, field, arity, ii;

	decompsel = document.getElementById('gDecompositionSelector');
	firstoption = decompsel.options[decompsel.selectedIndex];

	decompsel2 = document.getElementById('gDecompositionSelector2');
	while (decompsel2.options.length > 0)
		decompsel2.remove(decompsel.options[0]);

	option = document.createElement('option');
	option.value = '';
	option.appendChild(document.createTextNode('<none>'));
	decompsel2.appendChild(option);

	statsel = document.getElementById('gStatSelector');
	statoption = statsel.options[statsel.selectedIndex];
	metric = gMetrics[statoption.value];
	if (firstoption.value != '')
		arity = gFieldToArity(firstoption.value);
	else
		arity = null;

	for (ii = 0; ii < metric['fields'].length; ii++) {
		fieldname = metric['fields'][ii];
		field = gFields[fieldname];

		if (fieldname == firstoption.value)
			continue;

		if (firstoption.value !== '' &&
		    gFieldToArity(fieldname) == arity)
			continue;

		option = document.createElement('option');
		option.value = fieldname;
		option.appendChild(document.createTextNode(field['label']));
		decompsel2.appendChild(option);
	}

	decompsel2.selectedIndex = 0;

	if (firstoption.value === '' || decompsel2.options.length == 1)
		decompsel2.disabled = true;
	else
		decompsel2.disabled = false;
}

/*
 * The gGraph object represents a graph in the UI backed by a particular
 * instrumentation on the server.  The following configuration options MUST be
 * specified:
 *
 *	metric		identifies the module, stat, etc.  This should be one of
 *			the elements of gMetrics.
 *
 *	decomps		list of fields identifying the decomposition
 *
 *	predicate	the JSON representation of a predicate
 *
 * The following configuration options identifying the customer id (scope) and
 * instrumentation id MAY be specified:
 *
 *	customer_id	Customer ID for creating new instrumentations
 *			If unspecified, the global scope is assumed.
 *
 * The following additional options MAY be specified:
 *
 *	uri		Instrumentation's URI
 *			If undefined, instrumentation must not yet exist.
 *
 *	hmmode		if 'average', displays line graph of heatmap average
 *			value rather than the heatmap itself
 *
 *	hmpctile	if specified, displays line graph of specified
 *			percentile value rather than the heatmap itself
 */
function gGraph(conf)
{
	this.g_id = gGraph.gId++;
	this.g_metric = conf.metric;
	this.g_decomps = conf.decomps;
	this.g_predicate = conf.predicate;
	this.g_zoom = gZoomDefault;
	this.g_paused = false;
	this.g_ymin = gyMin;
	this.g_ymax = gyMax;
	this.g_scalemin = this.g_ymin;
	this.g_scalemax = this.g_ymax;
	this.g_secondsback = 0;
	this.g_legend_mode = 'summary';

	this.g_title = conf.metric.ca_label;

	if (conf.hmmode == 'average')
		this.g_title = 'Average of ' + this.g_title;
	else if (conf.hmpctile !== undefined)
		this.g_title = conf.hmpctile * 100 + 'th percentile of ' +
		    this.g_title;

	if (conf.decomps.length !== 0) {
		this.g_title += ' decomposed by ' +
		    conf.decomps.map(function (elt) {
			return (gFields[elt]['label']);
		    }).join(' and ');
	}

	if (!isEmpty(conf.predicate))
		this.g_title += ' predicated on ' +
		    this.predName(conf.predicate);

	this.g_http = 'http://' + gServer + ':' + gPort;
	this.g_uri_create = '/ca' + gCustUri(conf.customer_id) +
	    '/instrumentations';

	if (conf.uri)
		this.g_uri = conf.uri;

	this.initDetails(conf);
	this.initDom();
}

gGraph.gId = 0;

/*
 * Examines the selected metric and decomposition to determine the type and
 * subtype and various other fields required to build the DOM representation of
 * the graph and manage the underlying instrumentation state.  This method
 * initializes the following members:
 *
 *	g_type		'scalar' | 'vector'
 *			Used when processing raw data to determine what kind of
 *			data to expect for each raw datum.
 *
 *	g_subtype	'raw' | 'heatmap'
 *			Identifies the 'value' sub-URI to use to retrieve the
 *			value for this instrumentation.  Also controls what to
 *			do with the resulting value.
 *
 *	g_options	flot options to use for flot gaphs
 *	g_columns	columns to create in graph legend
 *
 * Additional subtype-specific fields are also initialized here.
 */
gGraph.prototype.initDetails = function (conf)
{
	var fieldname, discrete_decomp, label, ii, jj;
	var metric = this.g_metric, decomps = this.g_decomps;

	label = gMetricBase(this.g_metric);
	this.g_body = 'module=' + metric.module + '&stat=' + metric.stat;

	if (gPersistCheckbox.checked)
		this.g_body += '&persist-data=true';

	if (decomps.length === 0) {
		this.g_type = 'scalar';
		this.g_subtype = 'raw';
		this.g_rawrsrc = 'raw';
		this.g_rawfield = 'value';
		this.g_columns =  [ { sTitle: '' }, { sTitle: label } ];
		this.g_options = gScalarOptions;
	} else {
		this.g_type = 'vector';
		this.g_subtype = 'raw';
		this.g_rawrsrc = 'raw';
		this.g_rawfield = 'value';
		this.g_options = gVectorOptions;

		this.g_columns = [];
		for (ii = 0; ii < decomps.length; ii++) {
			this.g_body += '&decomposition=' + decomps[ii];

			for (jj = 0; jj < metric['fields'].length; jj++) {
				fieldname = metric['fields'][jj];
				if (decomps[ii] != fieldname)
					continue;

				if (gFieldToArity(fieldname) == 'numeric') {
					this.g_subtype = 'heatmap';
					this.g_rawrsrc = 'heatmap/image';
					this.g_rawfield = 'image';
					this.g_numeric_decomp =
					    gFields[fieldname];
					continue;
				}

				discrete_decomp = fieldname;
			}
		}

		if (discrete_decomp) {
			this.g_columns.push({
			    sTitle: gFields[discrete_decomp]['label']
			});
		} else {
			this.g_columns.push({ sTitle: '' });
		}

		this.g_columns.push({ sTitle: label });
	}

	if (!isEmpty(this.g_predicate)) {
		this.g_body += '&predicate=' + JSON.stringify(this.g_predicate);
	}

	if (conf.hmmode == 'average') {
		this.g_subtype = 'raw';
		this.g_rawrsrc = 'heatmap/average';
		this.g_rawfield = 'average';
		this.g_type = 'scalar';
		this.g_options = gScalarOptions;
	} else if (conf.hmpctile) {
		this.g_subtype = 'raw';
		this.g_rawrsrc = 'heatmap/percentile';
		this.g_rawfield = 'percentile';
		this.g_type = 'scalar';
		this.g_options = gScalarOptions;
		this.g_pctile = conf.hmpctile;
	}

	if (this.g_subtype == 'raw') {
		this.g_data = {};
	} else {
		this.g_hues = [];
		this.g_selected = {};
		this.g_ncreated = 0;
		this.g_coloring = 'rank';
		this.g_weights = 'count';
		this.g_show = 'all';
	}
};

/*
 * Constructs the DOM representation of this graph, accessible thereafter using
 * the getContainer() accessor method.
 */
gGraph.prototype.initDom = function ()
{
	var graph = this;
	var div, elt, table, tr, td, legend, tbody, slider, text;

	div = this.g_elt_container = document.createElement('div');
	div.className = 'gGraphContainer';

	div.appendChild(this.createToolbar(elt));

	table = div.appendChild(document.createElement('table'));
	tr = table.appendChild(document.createElement('tr'));
	td = tr.appendChild(document.createElement('td'));

	elt = this.g_elt_graph = td.appendChild(document.createElement('div'));
	elt.className = 'Graph';
	elt.id = 'graph' + this.g_id;
	elt.style.width = gPlotWidth + 'px';
	elt.style.height = gPlotHeight + 'px';

	td = tr.appendChild(document.createElement('td'));
	td.className = 'GraphLegend';
	legend = td.appendChild(document.createElement('table'));
	legend.appendChild(document.createElement('thead'));
	tbody = legend.appendChild(document.createElement('tbody'));
	legend.id = 'legend' + this.g_id;

	this.g_legend = legend;
	this.makeTable();

	if (this.g_subtype == 'heatmap') {
		td = tr.appendChild(document.createElement('td'));

		slider = td.appendChild(document.createElement('div'));
		slider.className = 'gRange';
		this.g_slider = slider;

		text = slider.appendChild(document.createElement('div'));
		text.className = 'gRangeText';
		this.g_slider_text = text;
	}

	/*
	 * We use the mousedown event as opposed to the click because most
	 * browsers do not send a click event for the right mouse button. It's
	 * as though Steve Job's one button mouse has taken over the Browser
	 * world.
	 */
	$(tbody).mousedown(function (event) {
		switch (event.which) {
		case 1:
			graph.heatmapRowClicked(event);
			break;
		default:
			graph.legendRowRightClicked(event);
			break;
		}
	});
};

/*
 * Constructs the DOM representation for this graph's toolbar.
 */
gGraph.prototype.createToolbar = function ()
{
	var graph = this;
	var head, div, subdiv, drill, fieldname;
	var dialog, diadiv, diaform, diacur, enabDia, diaOpt, diasel, ii;

	head = document.createElement('p');
	head.appendChild(document.createTextNode(this.g_title));

	div = document.createElement('div');
	div.className = 'gGraphHeader ui-widget-header ui-corner-all';
	div.appendChild(head);

	subdiv = div.appendChild(document.createElement('div'));
	subdiv.className = 'gToolbar';

	subdiv.appendChild(this.createButton({
		text: false,
		label: 'delete',
		icons: { primary: 'ui-icon-close' }
	}, function () { gRemoveStat(graph); }));

	subdiv.appendChild(this.createButton({
		text: false,
		label: 'zoom out',
		icons: { primary: 'ui-icon-zoomout' }
	}, function () { graph.zoomOut(); }));

	subdiv.appendChild(this.createButton({
		text: false,
		label: 'zoom in',
		icons: { primary: 'ui-icon-zoomin' }
	}, function () { graph.zoomIn(); }));

	subdiv.appendChild(this.createButton({
		text: false,
		label: 'look at older data',
		icons: { primary: 'ui-icon-seek-prev' }
	}, function () { graph.scrollBack(); }));

	this.g_pausebutton = this.createToggleButton('paused', [ {
	    onclick: function () { graph.unpaused(); },
	    label: 'pause',
	    value: false,
	    options: {
		text: false,
		label: 'pause',
		icons: { primary: 'ui-icon-pause' }
	    }
	}, {
	    label: 'resume',
	    value: true,
	    options: {
		text: false,
		label: 'resume',
		icons: { primary: 'ui-icon-play' }
	    }
	} ]);
	subdiv.appendChild(this.g_pausebutton);

	subdiv.appendChild(this.createButton({
		text: false,
		label: 'look at newer data',
		icons: { primary: 'ui-icon-seek-next' }
	}, function () { graph.scrollForward(); }));

	dialog = subdiv.appendChild(document.createElement('div'));
	$(dialog).dialog({
		autoOpen: false,
		title: 'Add predicate'
	});

	diadiv = document.createElement('div');

	$(dialog).append(diadiv);

	diaform = diadiv.appendChild(document.createElement('form'));
	var diapar = diaform.appendChild(document.createElement('p'));
	diapar.appendChild(document.createTextNode('Field: '));
	diacur = diapar.appendChild(document.createElement('select'));
	diacur.id = 'gDrilldownField' + graph.g_id;
	diacur.onchange = function () {
	    var graphid = graph.g_id;
	    gDrillFieldChanged(graphid);
	};

	diasel = diacur;

	enabDia = false;
	diaOpt = diacur.appendChild(document.createElement('option'));
	diaOpt.value = '';
	diaOpt.appendChild(document.createTextNode('<None>'));
	for (ii = 0; ii < graph.g_metric['fields'].length; ii++) {
		fieldname = graph.g_metric['fields'][ii];
		enabDia = true;
		diaOpt = diacur.appendChild(
		    document.createElement('option'));
		diaOpt.value = fieldname;
		diaOpt.appendChild(document.createTextNode(
		    gFields[fieldname]['label']));
	}

	diapar = diaform.appendChild(document.createElement('p'));
	diapar.appendChild(document.createTextNode('Operator: '));
	diacur = diapar.appendChild(document.createElement('select'));
	diacur.id = 'gDrilldownOperator' + graph.g_id;
	diaOpt = diacur.appendChild(document.createElement('option'));
	diaOpt.value = '';
	diaOpt.appendChild(document.createTextNode('<None>'));
	diacur.disabled = true;
	diacur.onchange = function () {
	    var graphid = graph.g_id;
	    gDrillOpChanged(graphid);
	};

	diapar = diaform.appendChild(document.createElement('p'));
	diacur = diapar.appendChild(document.createElement('label'));
	diacur.appendChild(document.createTextNode('Value: '));
	diacur = diapar.appendChild(document.createElement('input'));
	diacur.type = 'text';
	diacur.disabled = true;
	diacur.id = 'gDrilldownValue' + graph.g_id;

	diapar = diaform.appendChild(document.createElement('p'));
	diacur = diapar.appendChild(document.createElement('input'));
	diacur.disabled = true;
	diacur.type = 'button';
	diacur.id = 'gDrilldownSubmit' + graph.g_id;
	diacur.value = 'Add';
	diacur.onclick = function () {
	    var gid = graph.g_id;
	    var dia = dialog;
	    gDrillSubmit(gid, dia);
	};

	if (enabDia) {
		drill = subdiv.appendChild(document.createElement('button'));

		drill.appendChild(document.createTextNode('drilldown'));
		$(drill).button({
		    text: false,
		    label: 'add predicate',
		    icons: { primary: 'ui-icon-plus' }
		}).click(function () {
		    /* Make sure we reset the drilldown to empty */
		    diasel.selectedIndex = 0;
		    gDrillFieldChanged(graph.g_id);
		    $(dialog).dialog('close');
		    $(dialog).dialog('open');
		});
	}

	if (this.g_subtype != 'heatmap') {
		subdiv.className += ' gDiscrete';
		return (div);
	}

	subdiv.className += ' gNumeric';

	subdiv.appendChild(this.createButton({
		text: true,
		label: 'avg'
	}, function () { graph.showAverage(); }));

	subdiv.appendChild(this.createButton({
		text: true,
		label: 'median'
	}, function () { graph.showPercentile(0.5); }));

	subdiv.appendChild(this.createButton({
		text: true,
		label: '99.99'
	}, function () { graph.showPercentile(0.9999); }));

	subdiv.appendChild(this.createToggleButton('show', [ {
	    label: 'show: all, highlight selected',
	    value: 'all'
	}, {
	    label: 'show: only selected (highlighted)',
	    value: 'isolate'
	}, {
	    label: 'show: all but selected',
	    value: 'exclude'
	}, {
	    label: 'show: all, highlight all',
	    value: 'rainbow'
	} ]));

	subdiv.appendChild(this.createToggleButton('weights', [
	    { label: 'values: by count', value: 'count' },
	    { label: 'values: by weight', value: 'weight' }
	]));

	subdiv.appendChild(this.createToggleButton('coloring', [
	    { label: 'color: by rank', value: 'rank' },
	    { label: 'color: by value (linear)', value: 'linear' }
	]));

	return (div);
};

/*
 * Creates a button that toggles the given "field", whose state is stored in a
 * member of this graph called 'g_$field'.  Each of exactly two choices must
 * specify a label and a value.
 */
gGraph.prototype.createToggleButton = function (field, choices)
{
	var graph = this;
	var button = document.createElement('button');
	var label = choices[0].label;
	var ii;

	if (label)
		button.appendChild(document.createTextNode(label));

	for (ii = 0; ii < choices.length; ii++) {
		if (choices[ii].options)
			continue;

		choices[ii].options = { label: choices[ii].label };
	}

	button.caToggle = function () {
		graph.toggle(field, choices, button);
	};

	$(button).button(choices[0].options).click(
	    function () { button.caToggle(); });

	return (button);
};

/*
 * Creates a non-toggle button that invokes the specified callback when clicked.
 * 'Options' represents the JQuery button options and usually contains either
 * 'label' or 'icons'.
 */
gGraph.prototype.createButton = function (options, callback)
{
	var button = document.createElement('button');
	if (options.label)
		button.appendChild(document.createTextNode(options.label));
	$(button).button(options).click(callback);
	return (button);
};

/*
 * Invoked when a toolbar toggle button has been clicked to update the graph's
 * value for this property and update the button's state.
 */
gGraph.prototype.toggle = function (field, choices, button)
{
	var options, callback, fieldval;
	var text, current, next, ii;

	text = $(button).text();

	for (ii = 0; ii < choices.length; ii++) {
		if (text == choices[ii]['label']) {
			current = ii;
			break;
		}
	}

	next = (current + 1) % choices.length;
	options = choices[next]['options'];
	fieldval = choices[next]['value'];
	callback = choices[next]['onclick'];

	$(button).button('option', options);
	this['g_' + field] = fieldval;

	if (callback)
		callback();

	this.refresh(true);
};

gGraph.prototype.getContainer = function () { return (this.g_elt_container); };
gGraph.prototype.getId = function () { return (this.g_id); };

/*
 * Creates the underlying instrumentation on the server for this graph.  If the
 * instrumentation already exists, the behavior is undefined.  The callback is
 * invoked with two arguments: a non-empty error string if an error occurred, or
 * the object returned by the server for this call.
 */
gGraph.prototype.serverCreate = function (callback)
{
	var graph = this;
	var url = this.g_http + this.g_uri_create;
	var request = new XMLHttpRequest();

	request.open('POST', url, true);
	request.setRequestHeader('Content-Type',
	    'application/x-www-form-urlencoded');
	request.send(this.g_body);
	request.onreadystatechange = function () {
		var value, errmsg;

		if (request.readyState != 4)
			return;

		if (request.status != 201) {
			try {
				/*
				 * In Firefox, accessing this field can generate
				 * an exception.
				 */
				errmsg = request.statusText + ': ' +
				    request.responseText;
			} catch (ex) {
				errmsg = '<unknown error: ' +
				    request.status + '>';
			}

			callback('failed to create stat: ' + errmsg);
			return;
		}

		value = JSON.parse(request.responseText);
		graph.g_uri = value.uri;

		setTimeout(function () {
			callback(null, value);
		}, 1000);
	};
};

/*
 * Deletes the underlying instrumentation on the server.  The callback is
 * invoked with a non-empty error string if any error occurs.
 */
gGraph.prototype.serverDelete = function (callback)
{
	var request;
	var url = this.g_http + this.g_uri;

	request = new XMLHttpRequest();
	request.open('DELETE', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 204)
			callback('failed to delete stat: ' +
			    request.statusText + ': ' + request.responseText);
		else
			callback();
	};
};

/*
 * Returns the graph-state-specific parameters used when fetching the latest
 * value from the server for this graph's instrumentation.
 */
gGraph.prototype.uriParams = function (duration, start)
{
	var url = '', value;

	if (start)
		url = 'start_time=' + start + '&';

	if (this.g_subtype != 'heatmap' && this.g_pctile === undefined)
		return (url ? '?' + url : '');

	if (this.g_pctile !== undefined) {
		url += 'percentile=' + this.g_pctile + '&';
	} else {
		url += 'width=' + gPlotWidth + '&';
		url += 'height=' + gPlotHeight + '&';
		url += 'coloring=' + this.g_coloring + '&';
		url += 'weights=' + this.g_weights + '&';
		url += 'duration=' + duration + '&';
	}

	url += 'ymin=' + this.g_ymin + '&';
	if (this.g_pctile !== undefined ||
	    (this.g_ymax !== undefined && this.g_ymax !== this.g_scalemax))
		url += 'ymax=' + this.g_ymax + '&';
	url += 'nbuckets=' + gnBuckets + '&';

	switch (this.g_show) {
	case 'rainbow':
		url += 'decompose_all=true&';
		break;

	case 'isolate':
		url += 'isolate=true&';
		break;

	case 'exclude':
		url += 'exclude=true&';
		/*jsl:fallthru*/

	case 'all':
	default:
		url += 'hues=21';
		break;
	}

	if (this.g_show != 'rainbow') {
		for (value in this.g_selected) {
			url += 'selected=' + encodeURIComponent(value) + '&';
			url += 'hues=' + this.g_selected[value] + '&';
		}
	}

	return ('?' + url);
};

/*
 * Retrieves a single data point for time 'start_time' and updates the
 * visualization.
 */
gGraph.prototype.retrieveDatum = function (duration, start_time)
{
	var graph = this;
	var request, url, params;

	params = this.uriParams(duration, start_time);
	url = this.g_http + this.g_uri + '/value/' + this.g_rawrsrc + params;
	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		var value = JSON.parse(request.responseText);
		if (!graph.g_present)
			graph.g_present = value.start_time + value.duration;

		if (graph.g_subtype == 'heatmap')
			graph.updateHeatmap(value);
		else
			graph.updateRaw(value);

		/*
		 * This is a bit of a hack, but other callers (e.g.,
		 * heatmapClicked) use g_uri_params to get the parameters used
		 * to build the current heatmap image.  However, while we may
		 * not have explicitly specified a value for "max" (allowing the
		 * server to pick it), these other callers will need to have
		 * "max" specified for retrieving the related URIs.  So we tack
		 * the server's value on here, but only if it wasn't already in
		 * the parameters.
		 */
		if (params.indexOf('&ymax=') == -1)
			params += '&ymax=' + value.ymax;

		graph.g_uri_params = params;
	};

};

/*
 * Kicks off an asynchronous update for this graph, retrieving the latest value
 * and updating the graph.
 */
gGraph.prototype.refresh = function (force)
{
	var start, duration, time, nretrieved;

	if (!force && this.g_present) {
		this.g_present++;

		if (this.g_paused)
			this.g_secondsback++;
	}

	if (this.g_paused && !force)
		return;

	/*
	 * If we don't know where the "present" is, we always ask the server for
	 * the latest data and start from there.
	 */
	duration = gZoomOptions[this.g_zoom];

	if (!this.g_present) {
		this.retrieveDatum(duration);
		return;
	}

	/*
	 * For subsequent requests for a heatmap, we only ever need to get one
	 * "datum" which represents the current visualization.
	 */
	start = this.g_present - this.g_secondsback - duration;
	if (this.g_subtype == 'heatmap') {
		this.retrieveDatum(duration, start);
		return;
	}

	/*
	 * For subsequent requests for a flot graph, we need to figure out which
	 * data points to request from the server and request all of them to
	 * fill in the entire graph.  We hope that most of the time we have most
	 * of the points because we'll only have advanced one second, but in
	 * some cases (as when we unpause or scroll back) we may not have many
	 * of the data points.
	 */
	nretrieved = 0;
	for (time = start; time < start + duration; time++) {
		if (time in this.g_data)
			continue;

		++nretrieved;
		this.retrieveDatum(duration, time);
	}

	/*
	 * We call updateRaw to update the visual representation of the graph
	 * now.  It's always safe to do this, but if we're going to update it
	 * again when the next data point comes in, updating it here makes the
	 * movement jerky.  So we only do this when we had all of the data
	 * points and didn't need to make any server requests.
	 */
	if (nretrieved === 0)
		this.updateRaw(null);
};

/*
 * Given the value of a heatmap instrumentation, updates the visualization.
 */
gGraph.prototype.updateHeatmap = function (value)
{
	var graph, div, img, present;

	graph = this;
	div = this.g_elt_graph;
	img = div.childNodes[0];

	if (!img)
		img = div.appendChild(document.createElement('img'));

	img.src = 'data:image/png;base64,' + value.image;
	if (!img.caClick) {
		$(img).click(function (event) { graph.heatmapClicked(event); });
		img.caClick = true;
	}

	present = value.present;
	present.sort();

	this.g_legend_summary = present.map(function (elt) {
		return ({ key: elt, val: [ elt, '' ] });
	});

	if (this.g_legend_mode == 'summary')
		this.updateTable(this.g_legend_summary);

	if (this.g_ymax == this.g_scalemax && value.ymax !== this.g_ymax) {
		this.g_scalemax = this.g_ymax = value.ymax;

		$(this.g_slider).slider({
			orientation: 'vertical',
			range: true,
			min: this.g_scalemin,
			max: this.g_scalemax,
			values: [ this.g_ymin, this.g_ymax ],
			stop: function (event, ui) {
				graph.g_ymin = ui.values[0];
				graph.g_ymax = ui.values[1];
				$(graph.g_slider_text).text(graph.sliderText());
			}
		});

		$(this.g_slider_text).text(this.sliderText());
	}
};

gGraph.prototype.sliderText = function ()
{
	var type, xform;

	type = gTypes[this.g_numeric_decomp['type']];
	xform = gTypeTransform(type, this.g_ymax);

	return (gValueRound(this.g_ymin / xform['divisor']) + ' - ' +
	    gValueRound(this.g_ymax / xform['divisor']) + ' ' + xform['label']);
};

/*
 * Given the value of a raw instrumentation, updates the flot visualization.
 * Note: the data is stored in an object indexed by start_time.  When we redraw
 * the graph (i.e. when we get a new data point), we prune any data we don't
 * need right now and then construct the representation we give to flot based on
 * what's there now.  It's a bit more expensive to recompute this every time,
 * but this allows us to deal more easily with data coming in out-of-order,
 * missing data points, scrolling back and forward in time, and pausing.
 */
gGraph.prototype.updateRaw = function (value)
{
	var graph, data;

	graph = this;

	if (value)
		this.g_data[value.start_time] = value[this.g_rawfield];

	data = this.rawRecompute();
	this.g_plot = $.plot(this.g_elt_graph, data, this.g_options);

	if (this.g_highlighted)
		this.updateHighlighting(this.g_highlighted);

	if (!this.g_bound) {
		$(this.g_elt_graph).bind('plotclick',
		    function (e, p, i) { graph.clicked(p); });
		this.g_bound = true;
	}
};

/*
 * For raw data plots (flot plots), recompute the complete set of data that we
 * need to hand to flot in order to redraw the graph.
 */
gGraph.prototype.rawRecompute = function ()
{
	var series, points, datum, row, data;
	var keytots, keys, colors;
	var ii, jj, key, time, timems, showother, othertot;
	var ndatapoints = gZoomOptions[this.g_zoom];
	var start = this.g_present - this.g_secondsback - ndatapoints;

	/*
	 * First, trim old data from g_data.  We could trim newer data too but
	 * this is unlikely to accumulate too much and we'll only have to
	 * refresh it again if the user scrolls forward or moves back to live.
	 * We could be even less aggressive than this to avoid having to refetch
	 * data when the user scrolls back but we don't want to accumulate
	 * unbounded amounts of memory.
	 */
	for (time in this.g_data) {
		if (time < start)
			delete (this.g_data[time]);
	}

	data = [];
	for (time = start; time < start + ndatapoints; time++) {
		timems = new Date(time * 1000);
		if (time in this.g_data)
			data.push([ timems, this.g_data[time] ]);
		else
			data.push([ timems, null ]);
	}

	if (this.g_type == 'scalar')
		return ([ this.rawRecomputeOne(this.g_title, data, start,
		    ndatapoints) ]);

	/*
	 * For vector-valued metrics, we essentially transpose the data: while
	 * our data is of the form (time, vector of scalars), flot wants an
	 * array of series, each of which is an array of (time, scalar) tuples.
	 * Each series is plotted separately in its own color.  Importantly, we
	 * don't want the colors to jump around as new series come and go, so we
	 * allocate colors ourselves to make sure they stay consistent over
	 * time.  We also don't want the legend to expand too large, so we only
	 * show the top N keys.
	 *
	 * Here's the process:
	 *
	 *   o Iterate over all keys at all data points and create a new mapping
	 *     from key name -> total over this period.
	 *
	 *   o Sort these key-value pairs by their totals.  Remove entries
	 *     not in the top N (gMaxSeries).
	 *
	 *   o Iterate over assigned colors.  If any colors are assigned to keys
	 *     not in the top N, remove the assignment.
	 *
	 *   o Construct the series: there will be at most N + 1 of them.
	 *
	 *	o For each of the top N keys, create a series from the values of
	 *	  each key at each data point we have.  Check whether we've
	 *	  assigned a color to this key: if so, use it.  Otherwise,
	 *	  allocate a new color.
	 *
	 *	o Create a series whose value at each point is the sum of each
	 *	  of the keys at this point that are NOT in the top N.  We can
	 *	  use the same color for all of these.
	 */
	keytots = {};
	for (ii = 0; ii < ndatapoints; ii++) {
		for (key in data[ii][1]) {
			if (!(key in keytots))
				keytots[key] = 0;

			keytots[key] += data[ii][1][key];
		}
	}

	keys = [];
	for (key in keytots)
		keys.push(key);

	keys.sort(function (k1, k2) { return (keytots[k2] - keytots[k1]); });
	for (ii = gMaxSeries; ii < keys.length; ii++)
		delete (keytots[keys[ii]]);
	keys = keys.slice(0, gMaxSeries);

	if (!this.g_colorsbykey)
		this.g_colorsbykey = {};

	colors = {};

	for (key in this.g_colorsbykey) {
		if (!(key in keytots)) {
			delete (this.g_colorsbykey[key]);
			continue;
		}

		colors[this.g_colorsbykey[key]] = key;
	}

	for (key in keytots) {
		if (key in this.g_colorsbykey)
			continue;

		for (ii = 0; gColors[ii] in colors; ii++) {
			if (ii > gColors.length - 1)
				throw ('error: too few colors');
		}

		colors[gColors[ii]] = key;
		this.g_colorsbykey[key] = gColors[ii];
	}

	series = [];
	for (ii = 0; ii < gColors.length && ii < keys.length; ii++) {
		key = colors[gColors[ii]];
		points = [];

		for (jj = 0; jj < ndatapoints; jj++) {
			datum = data[jj];

			if (datum === null || datum[1] === null) {
				points.push(null);
				continue;
			}

			points.push([ datum[0],
			    key in datum[1] ? datum[1][key] : 0 ]);
		}

		row = this.rawRecomputeOne(key, points, start, ndatapoints);
		row.stack = true;
		row.color = gColors[ii].css();
		series.push(row);
	}

	points = [];
	showother = false;
	for (ii = 0; ii < ndatapoints; ii++) {
		datum = data[ii];

		if (datum === null) {
			points.push(null);
			continue;
		}

		othertot = 0;
		for (key in datum[1]) {
			if (key in keytots)
				continue;

			showother = true;
			othertot += datum[1][key];
		}

		points.push([ datum[0], othertot ]);
	}

	if (showother) {
		row = this.rawRecomputeOne('&lt;other&gt;', points, start,
		    ndatapoints);
		row.stack = true;
		row.color = gColors[gColors.length - 1].css();
		series.push(row);
	}

	return (series);
};

/*
 * See rawRecomputeData -- this recomputes a single row.
 */
gGraph.prototype.rawRecomputeOne = function (label, rawdata, start, ndatapoints)
{
	var points = [];
	var ii;

	/*
	 * Fill in empty points with undefined to indicate "no data".
	 */
	for (ii = 0; ii < ndatapoints; ii++) {
		if (rawdata[ii] !== null) {
			points[ii] = rawdata[ii];
			continue;
		}

		points[ii] = [ new Date((start + ii) * 1000), undefined ];
	}

	return ({ label: label, data: points });
};

/*
 * Invoked when a flot plot is clicked.  Highlights the nearest data point and
 * updates the graph's side-legend with additional details about that point.
 */
gGraph.prototype.clicked = function (pos)
{
	var when = Math.round(pos.x / 1000);
	var datum = this.g_data[when];
	var ii, key, keys, legend;

	if (!datum)
		return;

	if (this.g_type == 'scalar') {
		legend = [ { key: datum, val: [ '', datum ] } ];
	} else {
		keys = [];
		for (key in datum)
			keys.push(key);
		keys.sort(function (k1, k2) {
			return (datum[k2] - datum[k1]);
		});

		legend = [];
		for (ii = 0; ii < keys.length; ii++) {
			legend.push({ key: keys[ii],
			    val: [ keys[ii],
				gMetricUnit(this.g_metric,
				    datum[keys[ii]]) ] });
		}
	}

	this.updateTable(legend, true);
	this.updateHighlighting(when * 1000);
};

/*
 * Highlights the specified point on a flot-based plot.
 */
gGraph.prototype.updateHighlighting = function (when)
{
	var ii, jj, data, start;

	this.g_highlighted = when;
	this.g_plot.unhighlight();
	data = this.g_plot.getData();

	for (ii = 0; ii < data.length; ii++) {
		for (jj = 0; jj < data[ii].data.length; jj++) {
			if (data[ii].data[jj])
				break;
		}

		if (!data[ii].data[jj])
			continue;

		start = data[ii].data[jj][0].getTime();
		if (when - start < 0)
			continue;

		this.g_plot.highlight(ii, jj + (when - start) / 1000);
	}
};

/*
 * Create a new data table for the current graph's legend.  We do this rather
 * than modify the existing one because the semantics of fnClearTable are
 * dubious at best.  In particular, calling this function doesn't always cause
 * the table to appear empty, but calling it on an empty table causes it to add
 * another row that says "No data in table".  So it doesn't always work on an
 * empty table, and it doesn't always work on a non-empty table.
 */
gGraph.prototype.makeTable = function ()
{
	var graph = this;

	this.g_table = $(this.g_legend).dataTable({
		aaData: [],
		bDestroy: true,
		bFilter: false,
		bJQueryUI: true,
		bAutoWidth: true,
		sScrollY: '300px',
		bPaginate: false,
		bScrollInfinite: true,
		aoColumns: this.g_columns,
		fnRowCallback: function (node) {
			if (node.firstChild.tabIndex === 0)
				return (node);

			node.firstChild.tabIndex = 0;
			$(node.firstChild).keydown(function (event) {
				graph.heatmapKeyPressed(event);
			});

			return (node);
		}
	});

	this.g_table.fnSort([ [ 1, 'desc' ], [ 0, 'asc' ] ]);
};

/*
 * Populate the specified graph's side legend with additional details.
 * 'entries' is an array of objects with the following members:
 *
 *	val	Value to add to side legend (jquery data table)
 *
 *	key	Identifier.  An entry's value will only be added to the legend
 *		when no other entry with the same key has ever been added.
 */
gGraph.prototype.updateTable = function (entries, clear)
{
	var focused = document.activeElement;
	var rows, ii;

	if (clear)
		this.makeTable();

	if (clear || !this.g_legend_rows)
		this.g_legend_rows = {};

	rows = this.g_legend_rows;

	for (ii = 0; ii < entries.length; ii++) {
		if (entries[ii].key in rows)
			continue;

		rows[entries[ii].key] =
		    this.g_table.fnAddData([ entries[ii].val ]);
	}

	focused.focus();
};

gGraph.prototype.allocateHue = function ()
{
	var which;

	if (this.g_hues.length > 0)
		return (this.g_hues.pop());

	which = this.g_ncreated++ % gColors.length;

	return (gColors[which].hue());
};

gGraph.prototype.deallocateHue = function (hue)
{
	this.g_hues.push(hue);
};

/*
 * Invoked when the user clicks a row in the table.
 */
gGraph.prototype.heatmapRowClicked = function (event)
{
	return (this.heatmapRowSelect(event.target, event.shiftKey));
};

gGraph.prototype.heatmapRowSelect = function (target, shift)
{
	var table = this.g_table;
	var hue, value, already;

	if (this.g_subtype != 'heatmap')
		return;

	value = table.fnGetData(target.parentNode)[0];
	already = value in this.g_selected;

	if (!shift) {
		$(table.fnSettings().aoData).each(function () {
			$(this.nTr).removeClass('row_selected');
			this.nTr.style.backgroundColor = '#ffffff';
		});

		this.g_selected = {};
		this.g_ncreated = 0;
		this.g_hues = [];
	}

	if (!already) {
		$(target.parentNode).addClass('row_selected');
		hue = this.allocateHue();
		this.g_selected[value] = hue;
		target.parentNode.style.backgroundColor =
		    new gColor([ hue, 0.9, 0.95 ], 'hsv').css();
	} else if (shift) {
		target.parentNode.style.backgroundColor = '#ffffff';
		this.deallocateHue(this.g_selected[value]);
		$(target.parentNode).removeClass('row_selected');
		delete (this.g_selected[value]);
	}

	target.focus();
	this.refresh(true);
};

/*
 * Invoked when the user presses a key on a row.
 */
gGraph.prototype.heatmapKeyPressed = function (event)
{
	var sibling;

	switch (event.which) {
	case 38: /* up arrow */
		/* jsl:fall-thru */
	case 75: /* 'k' key */
		sibling = event.target.parentNode.previousSibling;
		break;
	case 40: /* down arrow */
		/* jsl:fall-thru */
	case 74: /* 'j' key */
		sibling = event.target.parentNode.nextSibling;
		break;
	}

	if (!sibling)
		return;

	this.heatmapRowSelect(sibling.firstChild, event.shiftKey);
};

/*
 * Invoked when the user clicks on the heatmap itself.  Retrieve details about
 * this particular bucket and show it in a dialog.
 */
gGraph.prototype.heatmapClicked = function (event)
{
	var graph = this;
	var offset, xx, yy;
	var request, url;

	offset = $(event.target).offset();
	xx = event.pageX - offset.left;
	yy = event.pageY - offset.top;

	url = this.g_http + this.g_uri + '/value/heatmap/details' +
	    this.g_uri_params + '&x=' + xx + '&y=' + yy;
	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load details: ' +
			    request.responseText);
			return;
		}

		graph.showHeatmapDetails(JSON.parse(request.responseText));
	};
};

gGraph.prototype.showHeatmapDetails = function (details)
{
	var keys, entries;
	var key, ii;

	entries = [];
	keys = Object.keys(details.present);
	for (ii = 0; ii < keys.length; ii++) {
		key = keys[ii];

		if (details.present[key] === 0)
			continue;

		entries.push({ key: key, val: [ key, details.present[key] ] });
	}

	this.g_legend_details = entries;

	if (entries.length === 0) {
		this.g_legend_mode = 'summary';
		this.updateTable(this.g_legend_summary, true);
		return;
	}

	this.g_legend_mode = 'details';
	this.updateTable(entries, true);
};

/*
 * pauseInternal actually pauses the graph and toggles the toolbar button
 * Toggling the toolbar button is what actually updates g_paused.  This function
 * does nothing when the graph is already unpaused.
 */
gGraph.prototype.pauseInternal = function ()
{
	if (this.g_paused)
		return;

	this.g_pausebutton.caToggle();
};

/*
 * unpauseInternal actually unpauses the graph and toggles the toolbar button.
 * Toggling the toolbar button is what actually updates g_paused.  This function
 * does nothing when the graph is already unpaused.
 */
gGraph.prototype.unpauseInternal = function ()
{
	if (!this.g_paused)
		return;

	this.g_pausebutton.caToggle();
};

/*
 * unpaused is invoked by toggling the toolbar button and so happens both when
 * the user clicks the button and when unpauseInternal is invoked.
 */
gGraph.prototype.unpaused = function ()
{
	this.g_secondsback = 0;
};

gGraph.prototype.zoomIn = function ()
{
	if (this.g_zoom - 1 >= 0) {
		this.g_zoom--;
		this.refresh(true);
	}
};

gGraph.prototype.zoomOut = function ()
{
	if (this.g_zoom + 1 < gZoomOptions.length) {
		this.g_zoom++;
		this.refresh(true);
	}
};

gGraph.prototype.scrollBack = function ()
{
	this.pauseInternal();
	this.g_secondsback += parseInt(gZoomOptions[this.g_zoom] / 4, 10);
	this.refresh(true);
};

gGraph.prototype.scrollForward = function ()
{
	this.g_secondsback -= parseInt(gZoomOptions[this.g_zoom] / 4, 10);

	if (this.g_secondsback <= 0) {
		this.g_secondsback = 0;
		this.unpauseInternal();
		return;
	}

	this.pauseInternal();
	this.refresh(true);
};

gGraph.prototype.showAverage = function ()
{
	var graph = new gGraph({
		metric: this.g_metric,
		decomps: this.g_decomps,
		predicate: this.g_predicate,
		customer_id: gCustId() || undefined,
		hmmode: 'average'
	});

	gAppendGraph(graph);
};

gGraph.prototype.showPercentile = function (pctile)
{
	var graph = new gGraph({
		metric: this.g_metric,
		decomps: this.g_decomps,
		predicate: this.g_predicate,
		customer_id: gCustId() || undefined,
		hmpctile: pctile
	});

	gAppendGraph(graph);
};

/*
 * Represents a color.  You'd think that a library for this would already exist
 * -- and you'd be right.  There's a jQuery library for dealing with colors that
 * can convert between HSV and RGB and parse CSS color names.  Unfortunately, it
 * uses the same jQuery field ($.color) as a different implementation with an
 * incompatible interface that flot bundles and uses, so we can't use it here.
 * Thanks for nothing, client-side Javascript, jQuery, and flot, whose namespace
 * decisions have brought us here.
 *
 * The HSV <-> RGB conversion routines are ported from the implementations by
 * Eugene Vishnevsky:
 *
 *   http://www.cs.rit.edu/~ncs/color/t_convert.html
 */
function gColor()
{
	var rgb, space;

	if (arguments.length === 1) {
		this.css = arguments[0];
		rgb = $.color.parse(this.css);
		this.rgb = [ rgb.r, rgb.g, rgb.b ];
		return;
	}

	switch (arguments[1]) {
	case 'rgb':
	case 'hsv':
		space = arguments[1];
		break;
	default:
		throw ('unsupported color space: ' + arguments[1]);
	}

	this[space] = arguments[0];
}

gColor.prototype.hue = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[0]);
};

gColor.prototype.saturation = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[1]);
};

gColor.prototype.value = function ()
{
	if (!this.hsv)
		this.rgbToHsv();

	return (this.hsv[2]);
};

gColor.prototype.rgbToHsv = function ()
{
	var r = this.rgb[0], g = this.rgb[1], b = this.rgb[2];
	var min, max, delta;
	var h, s, v;

	r /= 255;
	g /= 255;
	b /= 255;

	min = Math.min(r, g, b);
	max = Math.max(r, g, b);
	v = max;

	delta = max - min;

	if (max === 0) {
		s = 0;
		h = 0;
	} else {
		s = delta / max;

		if (r == max)
			h = (g - b) / delta;
		else if (g == max)
			h = 2 + (b - r) / delta;
		else
			h = 4 + (r - g) / delta;

		h *= 60;

		if (h < 0)
			h += 360;
	}

	this.hsv = [ h, s, v ];
};

gColor.prototype.hsvToRgb = function ()
{
	/*
	 * Convert from HSV to RGB.  Ported from the Java implementation by
	 * Eugene Vishnevsky:
	 *
	 *   http://www.cs.rit.edu/~ncs/color/t_convert.html
	 */
	var h = this.hsv[0], s = this.hsv[1], v = this.hsv[2];
	var r, g, b;
	var i;
	var f, p, q, t;

	if (s === 0) {
		/*
		 * A saturation of 0.0 is achromatic (grey).
		 */
		r = g = b = v;

		this.rgb = [ Math.round(r * 255), Math.round(g * 255),
		    Math.round(b * 255) ];
		return;
	}

	h /= 60; // sector 0 to 5

	i = Math.floor(h);
	f = h - i; // fractional part of h
	p = v * (1 - s);
	q = v * (1 - s * f);
	t = v * (1 - s * (1 - f));

	switch (i) {
		case 0:
			r = v;
			g = t;
			b = p;
			break;

		case 1:
			r = q;
			g = v;
			b = p;
			break;

		case 2:
			r = p;
			g = v;
			b = t;
			break;

		case 3:
			r = p;
			g = q;
			b = v;
			break;

		case 4:
			r = t;
			g = p;
			b = v;
			break;

		default: // case 5:
			r = v;
			g = p;
			b = q;
			break;
	}

	this.rgb = [ Math.round(r * 255),
	    Math.round(g * 255), Math.round(b * 255)];
};

gColor.prototype.css = function ()
{
	if (!this.rgb)
		this.hsvToRgb();

	return ('rgb(' + this.rgb.join(', ') + ')');
};

gColor.prototype.toString = function ()
{
	return (this.css());
};

function gDrillFieldChanged(graphId)
{
	var fieldSel, opSel, valSel, opt, field, subSel;

	fieldSel = document.getElementById('gDrilldownField' + graphId);
	field = fieldSel.options[fieldSel.selectedIndex];
	opSel = document.getElementById('gDrilldownOperator' + graphId);
	valSel = document.getElementById('gDrilldownValue' + graphId);
	valSel.value = '';
	valSel.disabled = true;
	subSel = document.getElementById('gDrilldownSubmit' + graphId);
	subSel.disabled = true;

	opSel.disabled = true;
	while (opSel.options.length > 0)
		opSel.remove(opSel.options[0]);

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = '';
	opt.appendChild(document.createTextNode('<none>'));

	if (field.value === '')
		return;

	opSel.disabled = false;

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'eq';
	opt.appendChild(document.createTextNode('=='));

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'ne';
	opt.appendChild(document.createTextNode('!='));

	if (gFieldToArity(field.value) != 'numeric')
		return;

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'ge';
	opt.appendChild(document.createTextNode('>='));

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'gt';
	opt.appendChild(document.createTextNode('>'));

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'lt';
	opt.appendChild(document.createTextNode('<'));

	opt = opSel.appendChild(document.createElement('option'));
	opt.value = 'le';
	opt.appendChild(document.createTextNode('<='));
}

function gDrillOpChanged(graphId)
{
	var opSel, valSel, subSel;

	opSel = document.getElementById('gDrilldownOperator' + graphId);
	valSel = document.getElementById('gDrilldownValue' + graphId);
	subSel = document.getElementById('gDrilldownSubmit' + graphId);

	valSel.disabled = true;
	subSel.disabled = true;

	if (opSel.options[opSel.selectedIndex].value === '')
		return;

	valSel.disabled = false;
	subSel.disabled = false;
}

function gDrillSubmit(graphId, dialog)
{
	var field, op, val;
	var fieldSel, opSel, valSel;
	var pred, npred, graph;

	fieldSel = document.getElementById('gDrilldownField' + graphId);
	opSel = document.getElementById('gDrilldownOperator' + graphId);
	valSel = document.getElementById('gDrilldownValue' + graphId);

	field = fieldSel.options[fieldSel.selectedIndex].value;
	op = opSel.options[opSel.selectedIndex].value;
	val = valSel.value;

	/* Potentially parse the value to a number if the field is numeric */
	if (gFieldToArity(field) == 'numeric') {
		val = parseInt(val, 10);
		if (isNaN(val)) {
			alert('field has numeric arity, must specify a ' +
			    'number');
			return;
		}
	}

	npred = {};
	npred[op] = [ field, val];

	pred = gGraphs[graphId].g_predicate;
	if (!isEmpty(pred)) {
		pred = { and: [ pred, npred ] };
	} else {
		pred = npred;
	}

	graph = new gGraph({
		metric: gGraphs[graphId].g_metric,
		decomps: gGraphs[graphId].g_decomps,
		predicate: pred,
		customer_id: gCustId() || undefined
	});

	gAppendGraph(graph);

	$(dialog).dialog('close');
}

/*
 * Finishes the creation of a graph
 */
function gAppendGraph(graph)
{
	var container;

	container = document.getElementById('gContainerDiv');
	container.appendChild(graph.getContainer());
	graph.serverCreate(function (err, result) {
		if (err) {
			container.removeChild(graph.getContainer());
			alert(err);
			return;
		}

		gGraphs[graph.getId()] = graph;
	});
}

function isEmpty(obj)
{
	/*jsl:ignore*/
	for (var key in obj)
		return (false);
	/*jsl:end*/

	return (true);
}

var predKeyMap = {
    and: '&&',
    or: '||',
    lt: '<',
    le: '<=',
    ge: '>=',
    gt: '>',
    ne: '!=',
    eq: '=='
};

/*
 * Construct the name for a predicate
 */
gGraph.prototype.predName = function (pred)
{
	var key, pname;
	var ret = '';
	var graph = this;
	var elts;

	/*
	 * With the way predicates are currently constructed there should only
	 * ever be one key in the object.
	 */
	for (var k in pred)
		key = k;

	switch (key) {
	case 'and':
	case 'or':
		elts = pred[key].map(function (x, loc) {
			return (graph.predName(x));
		});
		ret = elts.join(' ' + predKeyMap[key] + ' ');
		break;
	default:
		pname = gFields[pred[key][0]]['label'];
		ret += pname + ' ' + predKeyMap[key] + ' ' +
		    pred[key][1];
		break;
	}

	return (ret);
};

/*
 * Given a metric it returns an object with keys as types and values as the
 * keys of the field.
 */
function gatherMetricFieldsByType(metric)
{
	var ii, fieldname;
	var fields = metric['fields'];
	var ret = {};

	for (ii = 0; ii < fields.length; ii++) {
		fieldname = fields[ii];
		ret[fieldname] = {
		    type: gFieldToArity(fieldname),
		    label: gFields[fieldname]['label']
		};
	}

	return (ret);
}

function gatherMetricCombos(fields)
{
	var ii, jj, key;
	var discrete = [];
	var numeric = [];
	var ret = [];

	for (key in fields) {
		if (fields[key]['type'] == 'numeric')
			numeric.push(key);
		else
			discrete.push(key);
	}

	ret.push({ label: 'raw statistic', value: '' });
	for (ii = 0; ii < discrete.length; ii++)
		ret.push({
		    label: fields[discrete[ii]]['label'],
		    value: discrete[ii]
		});

	for (ii = 0; ii < numeric.length; ii++)
		ret.push({
		    label: fields[numeric[ii]]['label'],
		    value: numeric[ii]
		});

	for (ii = 0; ii < discrete.length; ii++) {
		for (jj = 0; jj < numeric.length; jj++)
			ret.push({
			    label: fields[numeric[jj]]['label'] + ' and ' +
				fields[discrete[ii]]['label'],
			    value: numeric[jj] + '&' + discrete[ii]
			});
	}

	return (ret);
}

/*
 * Produce a dialogue box that describes the right clicking of a legend row and
 * allows for investingating further.
 */
gGraph.prototype.legendRowRightClicked = function (event)
{
	var dialog, form, par, cur, sel, ii, disc;
	var graph = this;
	var rent = graph.g_table.fnGetData(event.target.parentNode)[0];
	var fields = gatherMetricFieldsByType(graph.g_metric);
	var combos = gatherMetricCombos(fields);

	for (ii = 0; ii < graph.g_decomps.length; ii++) {
		if (fields[graph.g_decomps[ii]]['type'] == 'discrete') {
			disc = fields[graph.g_decomps[ii]]['label'];
			break;
		}
	}

	form = document.createElement('form');
	form.id = 'gInvestigate' + graph.g_id;
	/* Create discrete question */
	par = form.appendChild(document.createElement('p'));
	par.appendChild(document.createTextNode('Predicating that \'' +
	    disc + '\' equals \'' +  rent + '\':'));
	par = form.appendChild(document.createElement('p'));
	par.appendChild(document.createTextNode('\tChange decomposition to:'));
	sel = par.appendChild(document.createElement('select'));
	sel.id = 'gInvestigateSel' + graph.g_id;
	for (ii = 0; ii < combos.length; ii++) {
		cur = sel.appendChild(document.createElement('option'));
		cur.value = combos[ii]['value'];
		cur.appendChild(document.createTextNode(combos[ii]['label']));
	}
	/* Go ahead and create an input */
	cur = form.appendChild(document.createElement('input'));
	cur.type = 'button';
	cur.id = 'gInvestigateSumbit' + graph.g_id;
	cur.value = 'Investigate!';
	cur.onclick = function () {
	    var gid = graph.g_id;
	    var dia = dialog;
	    gInvestigateSubmit(gid, dia, rent);
	};

	/* Put it all together */
	dialog = document.createElement('div');
	dialog.appendChild(form);
	$(dialog).dialog({ autoOpen: true, title: graph.g_metric.ca_label });
};

function gInvestigateSubmit(graphId, dialog, rent)
{
	var elt, ii, decomp, curDiscrete;
	var predicate = {};
	var decomps = [];
	var graph = gGraphs[graphId];
	var fields = gatherMetricFieldsByType(graph.g_metric);

	for (ii = 0; ii < graph.g_decomps.length; ii++) {
		if (fields[graph.g_decomps[ii]]['type'] == 'discrete') {
			curDiscrete = graph.g_decomps[ii];
			break;
		}
	}

	predicate['eq'] = [ curDiscrete, rent ];

	elt = document.getElementById('gInvestigateSel' + graph.g_id);
	decomp = elt.options[elt.selectedIndex].value;

	if (decomp != '') {
		ii = decomp.indexOf('&');
		if (ii != -1) {
			decomps.push(decomp.substring(0, ii));
			decomps.push(decomp.substring(ii + 1, decomp.length));
		} else {
			decomps.push(decomp);
		}
	}

	/* Preserve existing predicates */
	if (!isEmpty(graph.g_predicate))
		predicate =  { and: [ predicate, graph.g_predicate ] };

	graph = new gGraph({
		metric: graph.g_metric,
		decomps: decomps,
		predicate: predicate,
		customer_id: gCustId() || undefined
	});

	gAppendGraph(graph);

	/*
	 * We have to remember to destroy the underlying elements otherwise
	 * we're not going to properly reset our state.
	 */
	$(dialog).dialog('destroy');
	dialog.removeChild(document.getElementById('gInvestigate' + graphId));
}
