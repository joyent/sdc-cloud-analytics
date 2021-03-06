---
title: Joyent Cloud Analytics
apisections: API Introduction, Instrumentations API, Values API
markdown2extras: tables
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# Joyent Cloud Analytics

Cloud Analytics provides deep observability for systems and applications in a
SmartDataCenter cloud.  The CA service enables operators and end users to
dynamically instrument systems in the cloud to collect performance data that can
be visualized in real-time (through the operator or customer portals) or
collected using the API and analyzed later by custom tools.  This data can be
collected and saved indefinitely for capacity planning and other historical
analysis.


# Overview of Cloud Analytics
This section provides an overview of Cloud Analytics
concepts with examples of using the CA API. The second section is an API
reference that describes the API more completely.  The last two sections
describe the available metrics and fields.  It's strongly recommended to read
the first section before any others.

## CA Service

Operators and end users interface with the Cloud Analytics service either
directly through the CA HTTP REST API (part of the Cloud API) or through a
portal which itself uses the REST API.  The CA API allows users to:

* list available metrics and fields
* create and delete instrumentations
* retrieve values for instrumentations

These concepts are explained under "Building blocks" below.

For simplicity, this documentation assumes that parameters, payloads, and return
values are all specified using JSON, though the API supports other formats.  The
rest of the examples in this document will use "curl" to make requests and show
JSON responses.

In the examples, `$casvc` refers to the hostname used to access the Cloud API
HTTP service.

## Building blocks: metrics, instrumentations, and fields

A **metric** is any quantity that can be instrumented using CA.  For examples:

* Disk I/O operations
* Kernel thread executions
* TCP connections established
* MySQL queries
* HTTP server operations
* System load average

Each metric also defines which **fields** are available when data is collected.
These fields can be used to filter or decompose data.  For example, the Disk I/O
operations metric provides fields "hostname" (for the current server's
hostname) and "disk" (for the name of the disk actually performing an
operation), which allows users to filter out data from a physical server or
break out the number of operations by disk.

You can list the available metrics using the API:

	# curl $casvc/ca
	{
		"metrics": [ {
			"module": "disk",
			"stat": "physio_ops",
			"label": "I/O operations",
			"interval": "interval",
			"fields": [ "hostname", "disk", "optype", "latency",
			    "size", "offset" ],
			"unit": "operations"
		}, ...  ], ...
	}

The "module" and "stat" properties identify the metric.  The "/ca" resource
lists a lot of other information about the CA service, the details of which are
described in the API documentation.

When you want to actually gather data for a metric, you create an
**instrumentation**.  The instrumentation specifies:

* which metric to collect
* an optional **predicate** based on the metric's fields (e.g., only collect
  data from certain hosts, or for zones owned by a particular customer)
* an optional **decomposition** based on the metric's fields (e.g., break down
  the results by server hostname)
* how frequently to aggregate data (e.g., every second, every hour, etc.)
* how much data to keep (e.g., 10 minutes' worth, 6 months' worth, etc.)
* other configuration options

Continuing the above example, if the system provides the metric "Disk I/O
operations" with fields "hostname" and "disk", an example instrumentation might
specify:

* to collect data for the "Disk I/O operations" metric (the *metric*)
* to collect the data once per second and store it for 10 minutes
* to collect only data from host "hostA" (a *predicate*)
* to break out the results by disk name (a *decomposition*)

Here's an example of creating such an instrumentation.  For syntax details, see
the API documentation:

	# cat request.json
	{
		"module": "disk",
		"stat": "physio_ops"
		"granularity": 1,
		"retention-time": 600,
		"predicate": { "eq": [ "hostname", "headnode" },
		"decomposition": [ "disk" ]
	}

	# curl -X POST $casvc/ca/instrumentations -Trequest.json \
	    -H 'Content-type: application/json'
	{
		"module": "disk",
		"stat": "physio_ops",
		"predicate": { "eq": [ "hostname", "headnode" ] },
		"decomposition": [ "disk" ],
		"value-dimension": 2,
		"value-arity": "discrete-decomposition",
		"enabled": true,
		"retention-time": 600,
		"idle-max": 3600,
		"transformations": {},
		"nsources": 1,
		"granularity": 1,
		"persist-data": false,
		"crtime": 1308862234757,
		"value-scope": "interval",
		"uri": "/ca/instrumentations/16",
		"id": "16",
		"uris": [ {
		    "uri": "/ca/instrumentations/16/value/raw",
		    "name": "value_raw"
		} ],
		"warnings": []
	}

When we create this instrumentation, the system dynamically instruments the
relevant software and starts gathering data.  The data is made available
immediately in real-time.  To get the data for a particular point in time, you
retrieve the **value** of the instrumentation for that time:

	# curl $casvc/ca/instrumentations/16/value/raw
	{
		"value": {
		  "sd0": 1249,
		  "cmdk0": 0
		},
		"transformations": {},
		"start_time": 1308862501,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308862501,
		"requested_duration": 1,
		"requested_end_time": 1308862502
	}

To summarize: *metrics* define what data the system is capable of reporting.
*Fields* enhance the raw numbers with additional metadata about each event that
can be used for filtering and decomposition.  *Instrumentations* specify which
metrics to actually collect, what additional information to collect from each
metric, and how to store that data.  When you want to retrieve that data, you
query the service for the *value* of the instrumentation.


## Values and visualizations

We showed above how fields can be used to decompose results.  Let's look at that
in more detail.  We'll continue using the "Disk I/O operations" metric with
fields "hostname", and "disk".

### Scalar values

Suppose we create an instrumentation with no filter and no decomposition.  Then
the value of the instrumentation for a particular time interval might look
something like this (omitting several unrelated properties):

	{
		start_time: 1308789361,
		duration: 1,
		value: 573
	}

In this case, `start_time` denotes the start of the time interval in Unix time,
`duration` denotes the length of the interval, and `value` denotes the actual
value, which is 573.  This means that 573 disk I/O operations completed on all
systems in the cloud between times 1308789361 and 1308789362.

### Discrete decompositions

Now suppose we create a new instrumentation with a decomposition by hostname.
Then the raw value might look something like this:

	{
		start_time: 1308789361,
		duration: 1,
		value: {
			host1: 152,
			host2: 49,
			host3: 287,
			host4: 5
		}
	}

We call the decomposition by "hostname" a **discrete decomposition** because the
possible values of hostname ("host1", "host2", ...) are not numbers.

Similarly, we could examine the disk operations specific to a particular host
(say "host1") and decompose that by disk name.  We could create a new
instrumentation for that and the value might look something like this:

	{
		start_time: 1308789361,
		duration: 1,
		value: {
			disk1: 16,
			disk2: 57,
			disk3: 12
		}
	}

### Numeric decompositions

It's useful to decompose some metrics by numeric fields.  For example, you might
want to view disk I/O operations decomposed by latency (how long the operation
took).  The result is a *distribution*, which groups nearby latencies into
buckets and shows the number of disk I/O operations that fell into each bucket.
The result looks like this:

	{
		"start_time": 1308863061,
		"duration": 1,
		"value": [
			[ [ 53000, 53999 ], 4 ],
			[ [ 54000, 54999 ], 4 ],
			[ [ 55000, 55999 ], 7 ],
			...
			[ [ 810000, 819999 ], 1 ]
		]
	}

That data indicates that at time 1308863061, the system completed:

* 4 requests with latency between 53 and 54 microseconds,
* 4 requests with latency between 54 and 55 microseconds,
* 7 requests between 55 and 56 microseconds, and so on, and finally
* 1 request with latency between 810 and 820 microseconds.

This type of instrumentation is called a **numeric decomposition**.

### Combining decompositions

It's possible to combine a single discrete and numeric decomposition to produce
an object mapping discrete key to numeric distribution, whose value looks like
this:

	{
		"start_time": 1308863799,
		"duration": 1,
		"value": {
			"sd0": [
				[ [ 110000, 119999 ], 1 ],
				[ [ 120000, 129999 ], 1 ],
				...
				[ [ 420000, 429999 ], 1 ],
				[ [ 25000000, 25999999 ], 1 ]
			]
		}
	}

As we will see, this data allows clients to visualize the distribution of I/O
latency and then highlight individual disks in the distribution (or hosts, or
operation types, etc.).


### Value-related properties

We can now explain several of the instrumentation properties shown previously:

* `value-dimension`: the number of dimensions in returned values, which is
  the number of decompositions specified in the instrumentation, plus 1.
  Instrumentations with no decompositions have dimension 1 (scalar values).
  Instrumentations with a single discrete or numeric decomposition have value 2
  (vector values).  Instrumentations with both a discrete and numeric
  decomposition have value 3 (vector of vectors).
* `value-arity`: describes the format of individual values
    * `scalar`: the value is a scalar value (a number)
    * `discrete-decomposition`: the value is an object mapping discrete keys to
      scalars
    * `numeric-decomposition`: the value is either an object (really an array of
      arrays) mapping buckets (numeric ranges) to scalars, or an object mapping
      discrete keys to such an object.  That is, a numeric decomposition is one
      which contains at the leaf a distribution of numbers.

The arity serves as a hint to visualization clients: scalars are typically
rendered as line or bar graphs, discrete decompositions are rendered as stacked
or separate line or bar graphs, and numeric decompositions are rendered as
heatmaps.

### Heatmaps

Up to this point we have been showing **raw values**, which are JSON
representations of the data exactly as gathered by the Cloud Analytics service.
However, the service may provide other representations of the same data.  For
numeric decompositions, the service provides several **heatmap** resources that
generate heatmaps, like this one:

<img src="resources/heatmap.png" />

Like raw values, heatmap values are returned using JSON, but instead of
specifying a `value` property, they specify an `image` property whose contents
are a base64-encoded PNG image.  For details, see the API reference.  Using the
API, it's possible to specify the size of the image, the colors used, which
values of the discrete decomposition to select, and many other properties
controlling the final result.

Heatmaps also provide a resource for getting the details of a particular heatmap
bucket, which looks like this:

	{
		"start_time": 1308865184,
		"duration": 60,
		"nbuckets": 100,
		"width": 600,
		"height": 300,
		"bucket_time": 1308865185,
		"bucket_ymin": 10000,
		"bucket_ymax": 19999,
		"present": {
			"sd0": 52
			"sd1": 57
		},
		"total": 1,
	}

This example indicates the following about the particular heatmap bucket we
clicked on:

* the time represented by the bucket is 1308865185
* the bucket covers a latency range between 10 and 20 microseconds
* at that time and latency range, disk `sd0` completed 52 operations and disk
  `sd1` completed 57 operations.

This level of detail is critical for understanding hot spots or other patterns
in the heatmap.

Finally, heatmaps also provide resources for estimating the average value and
Nth percentile value for each column.  See the API reference for details.

## Data granularity and data retention

By default, CA collects and saves data each second for 10 minutes.  So if you
create an instrumentation for disk I/O operations, the service will save
the per-second number of disk I/O operations going back for the last 10
minutes.  These parameters are configurable using the following instrumentation
properties:

* `granularity`: how frequently to aggregate data, in seconds.  The default is 1
  second.  For example, a value of 300 means to aggregate every 5 minutes' worth
  of data into a single data point.  The smaller this value, the more space the
  raw data takes up.  `granularity` cannot be changed after an instrumentation
  is created.
* `retention-time`: how long, in seconds, to keep each data point.  The default
  is 600 seconds (10 minutes).  The higher this value, the more space the raw
  data takes up.  `retention-time` can be changed after an instrumentation is
  created.

These values affect the space used by the instrumentation's data.  For example,
all things being equal, the following all store the same amount of data:

* 10 minutes' worth of per-second data (600 data points)
* 50 minutes' worth of per-5-second data
* 25 days' worth of per-hour data
* 600 days' worth of per-day data

The system imposes limits on these properties so that each instrumentation's
data cannot consume too much space.  The limits are expressed internally as a
number of data points, so you can adjust granularity and retention-time to match
your needs.  Typically, you'll be interested in either per-second data for live
performance analysis or an array of different granularities and retention-times
for historical usage patterns.


## Data persistence

By default, data collected by the CA service is only kept in memory, not
persisted on disk.  As a result, transient failures of underlying CA service
instances can result in loss of the collected data.  For live performance
analysis, this is likely not an issue, since the likelihood of a crash is low
and the data can probably be collected again.  For historical data being kept
for days, weeks, or even months, it's necessary to persist data to disk.  This
can be specified by setting the `persist-data` instrumentation property to
"true".  In that case, CA will ensure that data is persisted at approximately
the `granularity` interval of the instrumentation, but no more frequently than
every few minutes.  (For that reason, there's little value in persisting an
instrumentation whose retention time is only a few minutes.)


## Transformations

Transformations are post-processing functions that can be applied to data when
it's retrieved.  You do not need to specify transformations when you create an
instrumentation; you need only specify them when you retrieve the value.
Transformations map values of a discrete decomposition to something else.  For
example, a metric that reports HTTP operations decomposed by IP address supports
a transformation that performs a reverse-DNS lookup on each IP address so that
you can view the results by hostname instead.  Another transformation maps IP
addresses to geolocation data for displaying incoming requests on a world map.

Each supported transformation has a name, like "reversedns".  When a
transformation is requested for a value, the returned value includes a
`transformations` object with keys corresponding to each transformation (e.g.,
"reversedns").  Each of these is an object mapping keys of the discrete
decomposition to transformed values.  For example:

	{
		"value": {
			"8.12.47.107": 57
		},
		"transformations": {
			"reversedns": {
				"8.12.47.107": [ "joyent.com" ]
			}
		},
		"start_time": 1308863799,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308863799,
		"requested_duration": 1,
		"requested_end_time": 1308863800
	}

Transformations are always performed asynchronously and the results cached
internally for future requests.  So the first time you request a transformation
like "reversedns", you may see no values transformed at all.  As you retrieve
the value again, the system will have completed the reverse-DNS lookup for
addresses in the data and they will be included in the returned value.


# API Introduction

## Versioning

The API version _must_ be specified in the `X-API-Version header`. All protocol
versions start with `ca/` and end with a semantic version number.
This protocol version is `ca/0.1.8`. If no `X-API-Version header` is specified,
version `ca/0.1.0` is assumed.

The service does not limit itself to the specified version, but rather ensures
that all parameters are interpreted as specified in that version and that return
values are formatted as specified in that version when using features only
present in that version. In other words, if a request specifies version X, it
can still make use of features from version X+1. The server only cares about the
version for cases where the semantics of parameters changed from version X to
version X + 1, or the structure of return payloads changed between those
versions.

See [Appendix A: Version History](#appendix-a-version-history) for a version history.


## Describe Metrics (GET /ca)

The root resource for the CA service returns a payload describing the modules,
metrics, fields, and types currently supported by the service.  Here's an
example of the CA resource return value:

	# curl $casvc/ca
	{
		"modules": {
			"cpu":		{ "label": "CPU" },
			"memory":	{ "label": "Memory" },
			...
		},

		"fields": {
    			"hostname": {
    				"label": "server hostname",
    				"type": "string"
    			},
			"runtime": {
				"label": "time on CPU",
				"type": "time"
			},
			"zonename": {
				"label": "zone name",
				"type": "string"
			}
		},

		"types": {
			"string": {
				"arity": "discrete",
				"unit": ""
			},
			"size": {
				"arity": "numeric",
				"unit": "bytes",
				"abbr": "B",
				"base": 2,
			},
			"time": {
    				"arity": "numeric",
    				"unit": "seconds",
    				"abbr": "s",
    				"base": 10,
    				"power": -9,
			}
		},

		"metrics": [ {
			"module": "cpu",
			"stat": "thread_executions",
			"label": "thread executions",
			"interval": "interval",
			"fields": [ "hostname", "zonename", "runtime" ],
			"unit": "operations"
		}, {
			"module": "memory",
			"stat": "rss",
			"label": "resident set size",
			"interval": "point",
			"fields": [ "hostname", "zonename" ],
			"type": "size"
		} ],

		"transformations": {
			"geolocate": {
				"label": "geolocate IP addresses",
				"fields": [ "raddr" ]
			},
			"reversedns": {
				"label": "reverse dns IP addresses lookup",
				"fields": [ "raddr" ]
			}
		}
	}

Each of these objects is covered in detail below.  **This information is
provided so that clients need not hardcode anything about particular metrics,
types, or fields in order to present appropriate visualizations, labels, and
menus for navigation.  The user interface can be driven entirely by this
metadata.**  (Of course, it doesn't have to be, but hardcoded interfaces may
require frequent updates as the CA service changes support for fields, types,
metrics, etc.)


### Modules

Each metric is identified by both a `module` and `stat` name.  Modules exist
as namespaces to organize metrics.  Module configuration returned by the `/ca`
resource looks like this:

	"modules": {
		"cpu":		{ "label": "CPU" },
		"memory":	{ "label": "Memory" },
		...
	}

Each module has a name (its key in the "modules" structure) and an object with a
single field called `label` which is its human-readable label.

### Metrics

Metrics describe quantities that can be measured by the system.  Data is not
collected for metrics unless an instrumentation has been configured for it.  For
details, see "Metrics" above.

Metrics are returned by the `/ca` resource like this:

	"metrics": [ {
		"module": "cpu",
		"stat": "thread_executions",
		"label": "thread executions",
		"interval": "interval",
		"fields": [ "hostname", "zonename", "runtime" ],
		"unit": "operations"
	}, {
		"module": "memory",
		"stat": "rss",
		"label": "resident set size",
		"interval": "point",
		"fields": [ "hostname", "zonename" ],
		"type": "size"
	} ]

Each metric has the following properties:

* `module`, `stat`: unique metric identifier.  The module will exist in
  "modules" as well.
* `label`: human-readable metric description.  This is intended to be combined
  with the module's label, so the second metric above would be called "Memory:
  resident set size".
* `interval`: either "interval" or "point", indicating whether the value of
  this metric covers activity over an *interval* of time or a snapshot of state
  at a particular `point*` in time.  For example, "resident set size" returns a
  snapshot of memory usage *at a given point in time*, while "thread executions"
  returns the number of scheduling events *during a given interval*.
* `fields`: a list of fields to be used for predicates and decompositions.
  Fields represent metadata available when data is collected that can be used to
  filter the data or break it out (e.g., by hostname).  Each field will be
  present in "fields" as well.  For more information, see "Fields" below.
* `type` or `unit`: used to display labels for values of this metric.  Only
  one of `type` or `unit` will be present.  If `unit` is present, then the value
  is simply a number labeled with that unit (like 10 "thread executions").  If
  `type` is present, the properties of that type describe how to best label it.
  For example, values of type "time" might be labeled as nanoseconds,
  milliseconds, or seconds based on powers of 10, while values of type "size"
  might be labeled as kilobytes, megabytes, etc. based on powers of 2.  For more
  information, see "Types" below.


### Fields

Fields represent metadata by which data points can be filtered or decomposed.
For example, most metrics support a "hostname" field which allows users to
filter out particular hosts (or only include certain hosts), or break out all of
the data by hostname.  See "Decompositions" above.

Fields are returned by the `/ca` resource like this:

	"fields": {
    		"hostname": {
    			"label": "server hostname",
    			"type": "string"
    		},
		"runtime": {
			"label": "time on CPU",
			"type": "time"
		},
		"zonename": {
			"label": "zone name",
			"type": "string"
		}
	}

Each field has the following properties:

* `label`: human-readable description of the field
* `type`: type of the field, which determines how to label it as well as whether
  the field is numeric or discrete.  For more information, see "Types" below.

Fields are either numeric or discrete based on the "arity" of their type.

Numeric fields:

* In predicates, values of numeric fields can be compared using numeric equality
  and inequality operators (=, <, >, etc.).
* In decompositions, a numeric field yields a numeric decomposition (see
  "Numeric decompositions" above).

Discrete fields:

* In predicates, values of discrete fields can only be compared using string
  equality.
* In decompositions, a discrete field yields a discrete decomposition (see
  "Discrete decompositions" above).

Note that some fields look like numbers but are used by software as identifiers
and so are actually discrete fields.  Examples include process identifiers,
which are numbers but for which it doesn't generally make sense to compare
using inequalities or decompose to get a numeric distribution.


### Types

Types are used with both metrics and fields for two purposes: to hint to clients
at how to best label values, and to distinguish between numeric and discrete
quantities.

Types are returned by the `/ca` resource like this:

	"types": {
		"string": {
			"arity": "discrete",
			"unit": ""
		},
		"size": {
			"arity": "numeric",
			"unit": "bytes",
			"abbr": "B",
			"base": 2,
		},
		"time": {
    			"arity": "numeric",
    			"unit": "seconds",
    			"abbr": "s",
    			"base": 10,
    			"power": -9,
		}
	}

Each type has the following properties:

* `arity`: indicates whether values of this type are "discrete" (e.g.,
  identifiers and other strings), or "numeric" (e.g., measurements).  This
  affects how such values can be used in predicates and decompositions.  See
  "Fields" above.
* `unit`: base unit for this type
* `abbr` (optional): abbreviation for the base unit for this type
* `base` (optional): if present, `base` indicates that when labeled, this
  quantity is usually labeled with SI prefixes corresponding to powers of the
  specified base.  For example, base-10 SI prefixes include nano, milli, micro,
  etc., while base-2 SI prefixes include kilo, mega, giga, etc.  The only bases
  used in CA are 10 and 2.
* `power` (optional): if present, this indicates that the raw values of this
  type are expressed in units corresponding to `base` raised to `power`.

Looking at the above example, this information conveys to clients that:

* "Strings" are discrete (can only be compared using "equals") and have no
  label.
* "Sizes" are numeric, expressed and labeled as "bytes" (abbreviated "B") with
  prefixes corresponding to powers of 2.  Clients can use this to label values
  as kilobytes, megabytes, gigabytes, etc. or KB, MB, GB, etc.
* "Times" are numeric, labeled as "seconds" (abbreviated "s"), but expressed as
  nanoseconds (10^-9).  Clients can use this to label values as nanoseconds,
  milliseconds, etc. or ns, ms, etc.


### Transformations

Transformations are post-processing functions that can be applied to data when
it's retrieved.  For more information, see "Transformations" above.

Transformations are returned by the `/ca` resource like this:

	"transformations": {
		"geolocate": {
			"label": "geolocate IP addresses",
			"fields": [ "raddr" ]
		},
		"reversedns": {
			"label": "reverse dns IP addresses lookup",
			"fields": [ "raddr" ]
		}
	}

Each transformation has the following properties:

* `label`: human-readable label for this transformation
* `fields`: array of field names that can be transformed by this
  transformation

The above transformations transform values of the "raddr" (remote address) field
of any metric to either an object with geolocation details or an array of
reverse-DNS hostnames, respectively.  To use transformations, see
"Using transformations" under "Values" below.


# Instrumentations API

Instrumentations describe which metrics to collect, at what frequency, and
several related parameters.  They can be listed, retrieved, created, edited,
deleted, and cloned.  For more information, see "Instrumentations" under
"Cloud Analytics" above.

## List Instrumentations (GET /ca/instrumentations)

### Inputs

* None

### Returns

Returns the list of instrumentations configured for the current
scope (usually a user). Here's an example instrumentation list:

	# curl $casvc/ca/instrumentations
	[ {
		"module": "syscall",
		"stat": "syscalls",
		"predicate": { "eq": [ "hostname", "headnode" ] },
		"decomposition": [ "syscall", "latency" ],
		"value-dimension": 3,
		"value-arity": "numeric-decomposition",
		"enabled": true,
		"retention-time": 600,
		"idle-max": 3600,
		"transformations": {},
		"nsources": 1,
		"granularity": 1,
		"persist-data": false,
		"crtime": 1308940620541,
		"value-scope": "interval",
		"uri": "/ca/instrumentations/1",
		"id": "1",
		"uris": [ {
			"uri": "/ca/instrumentations/1/value/heatmap/image",
			"name": "value_heatmap"
		}, {
			"uri": "/ca/instrumentations/1/value/heatmap/details",
			"name": "details_heatmap"
		}, {
			"uri": "/ca/instrumentations/1/value/raw",
			"name": "value_raw"
		} ]
	} ]

This list contains exactly one instrumentation.  The details are described
below.

## Create Instrumentation (POST /ca/instrumentations)

### Inputs
||module||String||required||
||stat||String||required||
||predicate|| Object (see Predicates) ||default: none||
||decomposition|| Array of strings ||default: `[]`||
||granularity|| Number ||default: 1||
||retention-time|| Number of seconds ||default: 600 (10 minutes)||
||persist-data|| Boolean ||default: false||
||idle-max|| Number of seconds ||default: 10 minutes||


Creates a new instrumentation with the specified properties.  Properties may be
specified either as HTML form fields (either in the URI as a querystring or in
the request body) or using JSON in the request body.  The following properties
*must* be specified for the instrumentation:

* `module`
* `stat`

These properties *may* be specified:

* `predicate` (default: none)
* `decomposition` (default: `[]`)
* `granularity` (default: 1)
* `retention-time` (default: unspecified)
* `persist-data` (default: false)
* `idle-max` (default: unspecified)

The remaining instrumentation properties are determined by the CA service.  See
`GET /ca/instrumentations` for details on individual properties.

## Get Instrumentation Properties (GET /ca/instrumentations/:id)

This resource returns a single instrumentation configured for the current scope
(usually a user).  Here's an example instrumentation:

	{
		"module": "syscall",
		"stat": "syscalls",
		"predicate": { "eq": [ "hostname", "headnode" ] },
		"decomposition": [ "syscall", "latency" ],
		"value-dimension": 3,
		"value-arity": "numeric-decomposition",
		"retention-time": 600,
		"granularity": 1,
		"idle-max": 3600,
		"transformations": {},
		"persist-data": false,
		"crtime": 1308940620541,
		"value-scope": "interval",
		"uri": "/ca/instrumentations/1",
		"id": "1",
		"uris": [ {
			"uri": "/ca/instrumentations/1/value/heatmap/image",
			"name": "value_heatmap"
		}, {
			"uri": "/ca/instrumentations/1/value/heatmap/details",
			"name": "details_heatmap"
		}, {
			"uri": "/ca/instrumentations/1/value/raw",
			"name": "value_raw"
		} ]
	}

All instrumentations have the following properties:

* `module`, `stat`: identifies the metric being collected.  See "Metrics" above.
* `predicate`: describes a filter on data points collected.  See "Predicate
  Syntax" below.
* `decomposition`: array of fields being decomposed.  See "Decompositions"
  above.
* `value-dimension`: indicates dimensionality of each value.  See
  "Value-related properties" above.
* `value-arity`: describes the format of each value.  See "Value-related
  properties" above.
* `retention-time`: number of seconds to retain collected data.  See "Data
  granularity and data retention" above.
* `granularity`: number of seconds between recorded data points.  The system may
  record data more frequently, but it will only aggregate it at this level of
  granularity.  See "Data granularity and data retention" above.
* `idle-max`: number of seconds after which if the instrumentation or its data
  has not been accessed via the API the service may delete the instrumentation
  and its data.
* `transformations`: array of transformations supported by this instrumentation.
  This is the subset of all transformations which operate on fields present in
  `decomposition`.  For example, you have to decompose by "raddr" to use the
  "geolocate" transformation, so instrumentations with a decomposition by
  "raddr" will have "geolocate" in this array.
* `persist-data`: boolean indicating whether data is being persisted on disk.
  See "Data persistence" above.
* `crtime`: time of creation of the instrumentation, in milliseconds since the
  Unix Epoch.
* `value-scope`: see the "interval" property of metrics, above.
* `id`: identifier for this instrumentation.  While this currently looks like a
  number, it's actually a string and should be treated as an opaque token.  The
  canonical URI is actually the preferred identifier.
* `uri`: canonical URI for this instrumentation.
* `uris`: array of related URIs, each with a "name" and "uri" property.

#### Predicate Syntax

Predicates allow you to filter out data points based on the *fields* of a
metric.  For example, instead of looking at Disk I/O operations in the whole
cloud, you may only care about operations with latency over 100ms, or on a
particular host.

Predicates are represented as JSON objects using an LISP-like syntax.  The
primary goal for predicate syntax is to be very easy to construct and parse
automatically to enable people to build tools to work with them.

The following leaf predicates are available:

| Predicate                    | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| { eq: [ fieldname, value ] } | equality (string or number, as appropriate).   |
| { ne: [ fieldname, value ] } | inequality (string or number, as appropriate). |
| { le: [ fieldname, value ] } | less than or equal to (numbers only).          |
| { lt: [ fieldname, value ] } | less than (numbers only).                      |
| { ge: [ fieldname, value ] } | greater than or equal to (numbers only).       |
| { gt: [ fieldname, value ] } | greater than (numbers only).                   |

Additionally, the following compound predicates are available:

| Predicate                   | Description                                 |
| --------------------------- | ------------------------------------------- |
| { and: [ predicate, ... ] } | all of subpredicates must be true.          |
| { or: [ predicate, ... ] }  | at least one of subpredicates must be true. |

All of these can be combined to form complex filters for drilling down.  For
example, this predicate could be used with the "logical filesystem operations" metric to
identify file operations performed by MySQL on machines "host1", "host2", or
"host3" that took longer than 100ms:

	{
		and: [
			{ eq: [ "execname", "mysqld" ] }
			{ gt: [ "latency", 100000000 ] },
			{ or: [
				{ eq: [ "hostname", "host1" ] },
				{ eq: [ "hostname", "host2" ] },
				{ eq: [ "hostname", "host3" ] }
			] },
		]
	}


## Modify Instrumentation Properties (PUT /ca/instrumentations/:id)

This resource allows the following properties of an existing instrumentation to
be changed:

* `retention-time`
* `idle-max`
* `persist-data`

The syntax for changing these properties is exactly the same as for creating a
new instrumentation, with the same limitations.  If `persist-data` is changed to
"false" from "true", all existing data may be deleted from disk.

## Delete Instrumentation (DELETE /ca/instrumentations/:id)

Deletes the specified instrumentation and all data associated with it.  The
system stops gathering data for the specified metric if there are no other
instrumentations using that metric.

## Clone Instrumentation (POST /ca/instrumentations/:id/clone)

This resource creates a **new** instrumentation based on the properties of an
existing one.  It is invoked and behaves exactly like `POST
/ca/instrumentations`, except that no arguments are required and the default
values for any properties not specified are taken from the specified
instrumentation rather than system defaults.


# Values API

Values are representations of metric data collected by instrumentations.  Each
value request specifies one or more time intervals using the following
properties:

* `start_time`: starting time of interval
* `duration`: length of interval (default: granularity of the instrumentation)
* `end_time`: ending time of interval (default: near the current time)
* `ndatapoints`: number of consecutive intervals' values to retrieve (default: 1)
* `transformations`: array of transformations to apply to field values

The system will retrieve `ndatapoints` number of datapoints with the first one
covering the interval [`start_time`, `end_time`), where `start_time` +
`duration` = `end_time`.  If `ndatapoints` > 1, then subsequent values are
consecutive intervals of length `duration`.

Any of `start_time`, `duration`, and `end_time` may be specified, though any two
is sufficient to identify an interval and the service will infer the third if
unspecified.  All times are specified in seconds since the Unix Epoch and
`duration` is measured in seconds.

The start time, end time, and duration should be evenly divisible by the
instrumentation's granularity.  If not, the start time will be rounded down and
the duration and end time rounded up as needed.  For example, if the granularity
is 1 minute, a request for the 30-second interval 6:40:20 to 6:40:50 will be
interpreted as the 1-minute interval 6:40:00 to 6:41:00.

Each returned value includes at least the following properties:

* `start_time`: the actual interval start time as modified by the service as
  described above
* `end_time`: the actual interval end time as modified by the service as
  described above
* `duration`: the actual interval duration as modified by the service as
  described above.
* `requested_start_time`: the start time from the original request (if any)
* `requested_end_time`: the end time from the original request (if any)
* `requested_duration`: the duration from the original request (if any)
* `transformations`: object containing transformed keys

If `ndatapoints` was specified (even if the value was 1), the returned value is
an array of objects with the above properties and other resource-specific
properties.  Otherwise, the returned value is one such object.

There are currently several kinds of values that can be retrieved.  Each kind
uses the above properties to specify the time interval but may also use other
parameters.  Similarly, each value resource returns the above properties but
also returns additional properties depending on the kind of value.

#### Using transformations

Transformations can be requested by specifying them by name in the
`transformations` property when retrieving a value.  The returned value contains
a `transformations` object whose keys are the specified transformations and
whose values are the transformed data.  See "Transformations" under "Cloud
Analytics" above for details.


## List Value Resources (GET /ca/instrumentations/:id/value)

This resource lists the top-level kinds of values that are valid for this
instrumentation with links to each.

## Retrieve Raw Data (GET /ca/instrumentations/:id/value/raw)

This resource retrieves the underlying raw data as JSON.  The value is returned
in the `value` property for each data point.  For example:

	# curl $casvc/ca/instrumentations/16/value/raw
	{
		"value": {
		  "sd0": 1249,
		  "cmdk0": 0
		},
		"transformations": {},
		"start_time": 1308862501,
		"duration": 1,
		"nsources": 1,
		"minreporting": 1,
		"requested_start_time": 1308862501,
		"requested_duration": 1,
		"requested_end_time": 1308862502
	}

## List Heatmap Resources (GET /ca/instrumentations/:id/value/heatmap)

For instrumentations with numeric decompositions only, this resource lists the
heatmap-related value resources for this instrumentation.

## Retrieve Heatmap Image (GET /ca/instrumentations/:id/value/heatmap/image)

For instrumentations with numeric decompositions only, this resource returns a
PNG image representing a *heatmap* of the underlying data.  Heatmaps resemble
scatter plots where the y-axis is partitioned into *buckets* and all data points
in each bucket drawn as a single block.  This visualization is very useful for
understanding complex distributions of numeric quantities, like operation
latency.

When requesting a heatmap image, any of the following properties may be
specified:

* `height`: height of the image, in pixels (default: unspecified)
* `width`: width of the image, in pixels (default: unspecified)
* `ymin`: y-axis value corresponding to the bottom of the image (default: 0)
* `ymax`: y-axis value corresponding to the top of the image (default: auto)
* `nbuckets`: number of buckets in the vertical dimension
* `selected`: array of field values to highlight (by default), isolate, or
  exclude.
* `isolate`: if true, only draw selected values.  Otherwise, selected values are
  highlighted over the background.
* `exclude`: if true, don't draw the selected field values at all (rather than
  highlight them)
* `hues`: array of colors for highlighting selected field values.  If `isolate`
  is false, the first hue is used for all of the unselected values.
* `decompose_all`: highlight all field values (possibly reusing hues)

At most one of `isolate`, `exclude`, and `decompose_all` may be specified.

The following properties are returned with each value:

* `image`: base64-encoded binary representation of the PNG image
* `present`: array of field values present in the heatmap

For examples, see "Heatmaps" under "Cloud Analytics" above.

## Retrieve Heatmap Bucket Details (GET /ca/instrumentations/:id/value/heatmap/details)

This resource allows you to retrieve the value of a particular bucket in the
heatmap.  Additional properties include:

* optional: `nbuckets`: same as heatmap image
* optional: `height`: same as heatmap image
* optional: `width`: same as heatmap image
* optional: `ymin`: same as heatmap image
* required: `ymax`: same as heatmap image
* required: `x` and `y`: coordinates of bucket inside image, using web browser
  convention (top-left is the origin)

The returned value includes the following properties:

* `bucket_time`: time corresponding to the bucket (Unix seconds)
* `bucket_ymin`: minimum y-axis value for the bucket
* `bucket_ymax`: maximum y-axis value for the bucket
* `present`: if the instrumentation defines a discrete decomposition, this
  property's value is an object whose keys are values of that field and whose
  values are the number of data points in that bucket for that key.
* `total`: the total number of data points in the bucket

For examples, see "Heatmaps" under "Cloud Analytics" above.

## Retrieve Heatmap Column Average Value (GET /ca/instrumentations/:id/value/heatmap/average)

This resource allows you to retrieve the estimated average value for a
particular time as computed from the heatmap.  For example, if you're looking
at a heatmap of system calls decomposed by latency, you can retrieve the
average system call latency using this resource.  The following properties can
be specified:

* optional: `nbuckets`: same as heatmap image (determines resolution used in
  computing the average)
* optional: `ymin`: same as heatmap image
* optional: `ymax`: same as heatmap image

The returned value contains the following property:

* `average`: the average value in the specified heatmap column

Note that the value is an approximation since nearby values in heatmaps are
grouped into buckets.

### `GET /ca/instrumentations/:id/value/heatmap/percentile`: Retrieve heatmap column Nth percentile value

This resource allows you to retrieve the estimated value for the Nth percentile
as computed from the heatmap.  For example, if you're looking at a heatmap of
system calls decomposed by latency, you can retrieve the 90th percentile
latency value, which is the smallest latency such that 90% of system calls
completed with lower latency.  The following properties can be specified:

* required: `percentile`: desired percentile, expressed as a number between 0
  (0%) and 1 (100%)
* optional: `nbuckets`: same as heatmap image (determines resolution used in
  computing the average)
* optional: `ymin`: same as heatmap image
* optional: `ymax`: same as heatmap image

The returned value contains the following property:

* `percentile`: the Nth percentile value in the specified heatmap column

Note that the value is an approximation since nearby values in heatmaps are
grouped into buckets.




# Metrics

Each description of a metric in this section begins with the following table:

| Datum              | Value                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | The name of the metric used in the API.                                                                                                                                                                                                                       |
| **Raw metric**     | What the metric itself measures.  Note that with no decompositions or predicates, a metric reports data for *all servers within a data center*.                                                                                                               |
| **Decompositions** | A list of fields you can use for filtering and decomposition.  All metrics contain a "hostname" field, which means you can choose to examine only the data from a single server ("predicating") or  breakdown the raw value by server name ("decomposition"). |
| **Visibility**     | Indicates whether the metric is available for cloud operators only or both operators and end users.  The "hostname" field is always hidden from end users.  End users are also only allowed to see data pertaining to their own zones and ZFS datasets.       |


To learn about the various decompositions provided by metrics, see "Fields" below.

## CPU-related metrics

The CPU metrics provide observability into CPU resource usage.  These metrics
allow operators to understand CPU utilization and saturation and for customers
to understand their usage of CPU resources and compare that to their limits.


### CPU: CPUs


| Datum              | Value                                |
| ------------------ | ------------------------------------ |
| **Name**           | cpu.cpus                             |
| **Raw metric**     | Number of CPUs                       |
| **Decompositions** | hostname, cpu, utilization (heatmap) |
| **Visibility**     | operators only                       |

This raw metric measures the number of CPUs, which itself may not be very
interesting.  However, the raw value can be decomposed by current utilization
and viewed as a heatmap, allowing operators to quickly see which CPUs are hot
within the datacenter or on a particular server.


### CPU: thread samples

| Datum              | Value                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Name**           | cpu.thread_samples                                                                           |
| **Raw metric**     | number of samples a thread was running on-CPU                                                |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid,<br/>pexecname, ppsargs, subsecond (heatmap) |
| **Visibility**     | operators and end users                                                                      |

This raw metric counts the number of times a non-idle thread was sampled on-CPU.
The sampling is performed at 99 Hertz (samples per second) per CPU, not 100
Hertz, to avoid sampling in lockstep with a timed activity.  This rate means
that each sample represents roughly 10 ms of CPU time.  The sampling is
performed across all CPUs, so the total samples possible during a second will
be 99 x number of CPUs.

This can be used to understand CPU usage at a coarse-grained level.  The
"subsecond" heatmap shows the time within a second on the y-axis, so that
regular timed activity can be observed as patterns, indicating how often during
a second a thread was on-CPU doing work.  A timed activity that occured once
per second at the same time would appear as a single horizontal line.  One that
crept over time by performing work and then sleeping for a full second would
appear as a diagonal line, the slope of which showing how much CPU work was
performed during each wakeup: steeper for more.

This lightweight metric may be a good starting point for CPU usage
investigations.  For more detail, see the CPU thread executions metric.


### CPU: thread executions

| Datum              | Value                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | cpu.thread_executions                                                                                                        |
| **Raw metric**     | number of times any thread runs continuously on CPU                                                                          |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname,<br/>ppsargs, leavereason, runtime (heatmap), subsecond (heatmap) |
| **Visibility**     | operators and end users                                                                                                      |

This raw metric counts the number of times any thread was taken off CPU (with
the exception of the kernel idle theads).  This can be used to understand CPU
usage at a very fine-grained level, since you can observe which applications
are running, for how long they're running before being kicked off CPU, and why
they're being kicked off CPU.  This in turn can help understand whether an
application is actually using a lot of CPU directly (e.g., on CPU for long
periods doing computation) vs. not (e.g., on CPU for many short bursts, then
waiting for I/O).

The "subsecond" heatmap shows the time offset within a second on the y-axis
for when the thread began to execute.  It can be interpreted in the same way
as the CPU thread samples subsecond heatmap.


### CPU: aggregated CPU usage

| Datum              | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| **Name**           | cpu.usage                                                               |
| **Raw metric**     | total amount of available CPU time used expressed as a percent of 1 CPU |
| **Decompositions** | hostname, zonename, cpumode                                             |
| **Visibility**     | operators and end users                                                 |

This raw metric reports the percent of CPU time used as a percent of 1 CPU's
maximum possible utilization.  For example, if a system has 8 CPUs, the maximum
value for that system will be 800.  On this system, an application fully
utilizing 2 CPUs for 1 second out of 5 will have a usage of 5% (25% of CPU, 20%
of the time).  This is most useful for understanding a zone's overall CPU usage
for load management purposes.  Also, since CPU caps are defined in terms of
aggregated CPU usage, this metric can show how close a zone is to reaching its
CPU cap.

It's important to remember that many applications do not effectively utilize
multiple CPUs.  As a result, an application may be compute-bound even though
its zone is not using all available CPU resources because the application may be
maxing out a single CPU.  To investigate this behavior, see the "CPU: cpus"
metric, which shows the utilization by-cpu, or the "CPU: thread executions"
metric, which can show the reason why an application is not using more CPU.


### CPU: aggregated wait time

| Datum              | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| **Name**           | cpu.waittime                                                     |
| **Raw metric**     | total amount of time spent by runnable threads waiting for a CPU |
| **Decompositions** | hostname, zonename                                               |
| **Visibility**     | operators and end users                                          |

This raw metric measures the total amount of time spent by runnable threads
waiting for a CPU.  The longer the aggregated wait time, the more time threads
spent waiting for an available CPU while ready to run.  Even on relatively idle
systems, it's normal to see non-zero wait time, since there are often more
threads ready to run than CPUs.  However, persistent high wait times indicate
CPU saturation.


### CPU: 1-minute load average

| Datum              | Value                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | cpu.loadavg1                                                                                                                      |
| **Raw metric**     | 1-minute load average. This loosely correlates with the average number of threads either running or runnable over the last minute |
| **Decompositions** | hostname, zonename                                                                                                                |
| **Visibility**     | operators only                                                                                                                    |

This raw metric roughly correlates with the average number of threads ready to
run at any given time over the last minute.  In raw form or when decomposed by
hostname, load average reflects the amount of work being done on the system, as
well as how much capacity is available for more work.

Care must be taken in interpreting the by-zonename numbers.  Like the
system-wide metric, the load average for a zone reflects the average number of
that zone's threads ready to run at any given time over the last minute.
However, a high load average for a zone does not necessarily mean that zone is
contributing much load to the system.  For example, a single very active zone on
a system can inflate the load averages of other zones on the system by keeping
the CPUs busy and causing other zones' threads to have to wait for the CPU.
Within a zone, the load average should be viewed not as a measure of the system
load induced by the zone but as a measure of the system load that's impacting
the zone (which may, of course, be caused by the zone itself).

See "CPU: aggregated wait time" for another measure of CPU saturation.


## Disk-related metrics

The disk metrics provide observability into disk I/O across a datacenter.

### Disk: disks

| Datum              | Value                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | disk.disks                                                                                                                                                      |
| **Raw metric**     | number of disks                                                                                                                                                 |
| **Decompositions** | hostname, disk, iops (heatmap), iops\_read (heatmap), iops\_write (heatmap), bytes (heatmap), bytes\_read (heatmap), bytes\_write (heatmap), busytime (heatmap) |
| **Visibility**     | operators only                                                                                                                                                  |

This raw metric measures the number of disks, which itself may not be very
interesting.  However, the raw value can be decomposed by percent busy time,
number of I/O operations completed, or number of bytes transferred, and the
result viewed as a heatmap.  This allows operators to quickly identify which
disks are busy within a datacenter or on a particular server.

Since individual disks have finite limits on both data throughput and IOPS, this
metric also allows administrators to identify disks that are maxed out, which
may be limiters for application performance.


### Disk: bytes read and written

| Datum              | Value                                   |
| ------------------ | --------------------------------------- |
| **Name**           | disk.physio_bytes                       |
| **Raw metric**     | number of bytes read or written to disk |
| **Decompositions** | hostname, disk, optype                  |
| **Visibility**     | operators only                          |

This metric measures the raw number of bytes read and/or written to disks.  This
allows operators to see whether disks are being driven to maximum throughput
(i.e. whether the workload is disk throughput-bound) as well as the
decomposition of read and write operations in the workload.


### Disk: I/O operations

| Datum              | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| **Name**           | disk.physio_ops                                                             |
| **Raw metric**     | number of disk I/O operations completed                                     |
| **Decompositions** | hostname, disk, optype, size (heatmap), offset (heatmap), latency (heatmap) |
| **Visibility**     | operators only                                                              |

This raw metric measures the raw number of read and write operations completed
by disks.  This allows operators to see whether disks are being driven to
maximum IOPS throughput (i.e. whether the workload is disk IOPS-bound).

Additionally, this metric provides decompositions by size and offset, which
help operators understand the nature of the I/O workload being applied, and
a decomposition by latency which provides deep understanding of disk performance
as it affects the workload.


## Filesystem-related metrics

The filesystem metrics provide visibility for logical filesystem operations
performed by system software and applications.  This is critically important
because the filesystem is the main interface through which applications access
disks, and disks can be a major source of system latency.  However, it's very
hard to correlate filesystem operations with disk operations for a large number
of reasons:

* Filesystem read operations (including "read", "lookup", etc.) may be satisfied
  from the OS cache, in which case the disk may not need to be accessed at all.
* A single logical filesystem read may require *multiple* disk reads because the
  requested chunk is larger than disk sector size or the filesystem block size.
* Even for a single logical filesystem read that's smaller than the disk sector
  size, the filesystem may require multiple disk reads in order to read the file
  metadata (e.g., indirect blocks).  Of course, any number of these reads may be
  satisfied by the OS read cache, reducing the number that actually hit the
  disk.
* Writes to files not marked for synchronous access will generally be cached in
  the OS and written out later.  However, if the write does not change an entire
  filesystem block, the OS will need to *read* all changed blocks (and the
  associated file metadata).
* Even writes that do rewrite an entire filesystem block may require reading
  file metadata (e.g., indirect blocks).

In summary, it's very difficult to predict for a given logical filesystem
operation what disk operations will correspond to it.  However, it's also not
generally necessary.  To understand application performance, you can use these
filesystem metrics to see logical filesystem operation *latency*.  If it's low,
then disk effects are not relevant.  Only if filesystem logical operation
latency is high should disk performance be suspected.  Similarly, if disk
operation latency is high, that doesn't mean applications are actually
experiencing that latency.


### Filesystem: logical filesystem operations

| Datum              | Value                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| **Name**           | fs.logical_ops                                                                                         |
| **Raw metric**     | number of logical filesystem operations                                                                |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, fstype, optype, latency (heatmap) |
| **Visibility**     | operators and end users                                                                                |

This raw metric measures the total number of logical filesystem operations,
including read, write, create, fsync, ioctl, mkdir, and many others.  The result
can be decomposed by host, zone, application, filesystem type, operation type,
and latency (as a heatmap).  This is a primary metric for understanding
application latency resulting from filesystem or disk slowness.  See the
description under "filesystem-related metrics" above.


### Filesystem: logical read/write operations

| Datum              | Value                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | fs.logical_rwops                                                                                                                         |
| **Raw metric**     | number of logical filesystem read/write operations                                                                                       |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, fstype, optype, size (heatmap), offset (hetamap), latency (heatmap) |
| **Visibility**     | operators and end users                                                                                                                  |

This raw metric measures the total number of read/write operations.  Unlike the
"logical filesystem operations" metric, this metric *only* counts reads and
writes, not the various metadata operations like create, fsync, ioctl, and
others.

The "size" heatmap shows the requested size in bytes of each I/O, and the
"offset" heatmap shows the byte location in the file that is being read or
written.  Both of these can be used to characterize the workload applied to
the file system by applications, and compared to the resulting workload at
the disk level.


### Filesystem: logical bytes read/written

| Datum              | Value                                |
| ------------------ | ------------------------------------ |
| **Name**           | fs.logical_rwbytes                   |
| **Raw metric**     | number of logical bytes read/written |
| **Decompositions** | hostname, zonename, optype           |
| **Visibility**     | operators and end users              |

This raw metric measures the total number of bytes logically read and written to
the filesystem.  This metric *only* counts reads and writes, not the various
metadata operations like create, fsync, ioctl, and others.


## Memory-related metrics

The Memory metrics report physical and virtual memory used by host and zone, as
well as events related to memory use like memory reclamations and page-ins.

### Memory: resident set size

| Datum              | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| **Name**           | memory.rss                                            |
| **Raw metric**     | total bytes of physical memory in use by applications |
| **Decompositions** | hostname, zonename                                    |
| **Visibility**     | operators and end users                               |

The resident set of an application is the amount of physical memory it's
currently using.  This metric provides that information in total, by hostname,
or by zonename.


### Memory: maximum resident set size

| Datum              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| **Name**           | memory.rss_limit                                          |
| **Raw metric**     | maximum bytes of physical memory allowed for applications |
| **Decompositions** | hostname, zonename                                        |
| **Visibility**     | operators and end users                                   |

This metric reports the system-imposed maximum resident set size in total, by
hostname, or by zonename.  See "Memory: resident set size."


### Memory: virtual memory reserved

| Datum              | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| **Name**           | memory.swap                                            |
| **Raw metric**     | total bytes of virtual memory reserved by applications |
| **Decompositions** | hostname, zonename                                     |
| **Visibility**     | operators and end users                                |

This metric measures the total amount of virtual memory reserved by
applications, optionally decomposed by hostname and zonename.  The operating
system reserves virtual memory for all memory an application allocates that's
not directly backed by the filesystem, including memory allocated with malloc()
(whether or not the memory has been used) or by privately mapped files.  Each
zone has a limit on the maximum amount of virtual memory that can be reserved.
This metric allows operators and end users to compare zone usage against that
limit.


### Memory: maximum virtual memory used

| Datum              | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| **Name**           | memory.swap_limit                                          |
| **Raw metric**     | maximum bytes of virtual memory reservable by applications |
| **Decompositions** | hostname, zonename                                         |
| **Visibility**     | operators and end users                                    |

This metric reports the maximum amount of virtual memory reservable by
applications, optionally decomposed by hostname and zonename.  See "Memory:
virtual memory reserved."


### Memory: excess memory reclaimed

| Datum              | Value                                         |
| ------------------ | --------------------------------------------- |
| **Name**           | memory.reclaimed_bytes                        |
| **Raw metric**     | total bytes of memory reclaimed by the system |
| **Decompositions** | hostname, zonename                            |
| **Visibility**     | operators and end users                       |

This metric reports the total number of bytes of physical memory (resident set)
reclaimed by the system because a zone has exceeded its allowable resident set
size.  Non-zero values for this metric indicate that a zone is exceeding its
physical memory limit and its memory is being paged out.


### Memory: pages paged in

| Datum              | Value                          |
| ------------------ | ------------------------------ |
| **Name**           | memory.pageins                 |
| **Raw metric**     | total pages of memory paged in |
| **Decompositions** | hostname, zonename             |
| **Visibility**     | operators and end users        |

This metric reports the total number of pages of virtual memory paged in.
Memory is paged in when it's needed by an application but is not currently in
physical memory because the zone has previously exceeded its physical memory
limit.

This metric is the flip side of excess memory reclaimed: when a zone exceeds
its physical limit, some memory is paged out, which can be observed with the
"Memory: excess memory reclaimed" metric.  When that memory is needed again,
it's paged back in, which can be observed using this metric.  In other words,
this metric shows when the zone is experiencing latency as a result of having
previously exceeded its memory limit.


## ldapjs-related metrics

The ldapjs metrics report LDAP protocol activity for Node.js programs using the
ldapjs library version 0.3.2 or later.

### ldapjs: connections

| Datum              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Name**           | ldapjs.connections                               |
| **Raw metric**     | number of client connections to the server       |
| **Decompositions** | hostname, zonename, pid, execname, psargs, raddr |
| **Visibility**     | operators and end users                          |

This metric reports client connections to an LDAP server, with decompositions
to identify the server process and client IP address.


### ldapjs: all operations

| Datum              | Value                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Name**           | ldapjs.ops                                                                                                     |
| **Raw metric**     | number of server LDAP operations                                                                               |
| **Decompositions** | hostname, zonename, pid, execname, psargs, raddr, optype, ldapbinddn, ldaprequestdn, status, latency (heatmap) |
| **Visibility**     | operators and end users                                                                                        |

This metric reports LDAP operations executed by the server, with decompositions
to identify the server process, client IP address, and operation details
(operation type, bind DN, request DN, and status).  The "latency" field shows a
heatmap of operation latency, which is useful for identifying cases where the
LDAP server is a source of systemic latency.  For such cases, the detail fields
can help isolate the types of operations taking the most time.

Additional information is available for "search" operations using the "ldapjs:
search operations" metric.


### ldapjs: search operations

| Datum              | Value                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | ldapjs.search_ops                                                                                                             |
| **Raw metric**     | number of LDAP "search" operations                                                                                            |
| **Decompositions** | hostname, zonename, pid, execname, psargs, raddr, ldapbinddn, ldaprequestdn, status, ldapfilter, ldapscope, latency (heatmap) |
| **Visibility**     | operators and end users                                                                                                       |

This metric reports LDAP "search" operations executed by the server, with
decompositions to identify the server process, client IP address, and search
query details.  This metric is similar to the "ldapjs: all operations" metric
but isolates only the "search" operations and includes search-specific fields
describing the filter and scope.  For investigating poor search performance,
these fields can be used to identify which queries are taking the most time.



## MySQL-related metrics

The MySQL metrics report activity for MySQL and Percona master database
servers.  These are only available for versions which support the DTrace mysql
provider, which is currently versions 5.5 and later which have been compiled
with ENABLE_DTRACE.  The metrics show connection, command, query, statement
and filesort details.

Some of these metrics follow an execution heirarchy, which is:

	connection
	 |
	 | command
	 |  |
	 |  | query
	 |  |  |
	 |  |  | statement
	 |  |  |  |
	 |  |  |  |
	 |  |  |  V
	 |  |  V
	 |  V
	 | ...
	 V

This makes it possible to analyze the MySQL database from different
perspectives.  The commands metric is the most inclusive, covering queries and
other command types, and including all latency incurred.  The statements metric
is most specific, which can show the SQL statement type and result of the
statement in terms of rows.


### MySQL: connections

| Datum              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| **Name**           | mysql.connections                                                          |
| **Raw metric**     | number of client connections to the database                               |
| **Decompositions** | hostname, zonename, pid, execname, psargs, user, client, latency (heatmap) |
| **Visibility**     | operators and end users                                                    |

This shows client connections to the database, providing breakdowns to show
the client username and client hostname.  The "latency" field shows a heatmap
depicting the entire duration of the connection, which may last many seconds
and span many queries.


### MySQL: commands

| Datum              | Value                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Name**           | mysql.commands                                                                                                 |
| **Raw metric**     | number of database commands                                                                                    |
| **Decompositions** | hostname, zonename, pid, execname, psargs, command, user, client, status, latency (heatmap), cputime (heatmap) |
| **Visibility**     | operators and end users                                                                                        |

This shows commands that are served by the database, and has a number
of breakdowns to show general characteristics of the workload: including the
command type, user name and client hostname.  The command result, success or
fail, can be seen using "status".

The "latency" breakdown shows command performance in detail, which can be used
to identify single outliers and patterns of degraded performance.  The latency
heatmap can be visually compared to the "cputime" heatmap, which shows the time
spent on-CPU for each command.  If these heatmaps look similar, then the
commands are spending most of their time on-CPU in the database.  If the
latency heatmap shows much higher latency than the cputime heatmap, then
commands are blocked off-CPU for some reason, which can include waiting on file
system I/O (including disk I/O), locks, and for their turn on-CPU.

A query command is one of the command types; others include preparing and
executing statements, and getting statistics.  Because of this, this command
metric has a more complete view of database requests than the queries metric.
The commands themselves are presented as their numeric values.  The "Command
Probes" section of the MySQL 5.5+ Reference Manual lists commands and their
descriptions.  Common command types include:

* 1: close connection
* 3: execute a query
* 9: get statistics
* 22: prepare a statement
* 23: execute a prepared statement


### MySQL: queries

| Datum              | Value                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | mysql.queries                                                                                                                |
| **Raw metric**     | number of database queries                                                                                                   |
| **Decompositions** | hostname, zonename, pid, execname, psargs, querysubstr, database, user, client, status, latency (heatmap), cputime (heatmap) |
| **Visibility**     | operators and end users                                                                                                      |

This shows the queries performed by the database, including query cache hits
and the execution of prepared statements.  This metric has a number of
decompositions to show general characteristics of the workload: including
the database name, user name and client hostname.  The query result, success
or fail, can be seen using "status".

The "latency" and "cputime" heatmaps provide detailed performance data, and
can be compared in the same way as with the commands metric, described
earlier.


### MySQL: statements

| Datum              | Value                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | mysql.statements                                                                                                             |
| **Raw metric**     | number of database statements                                                                                                |
| **Decompositions** | hostname, zonename, pid, execname, psargs, statement, status, rowsmatched, rowschanged, latency (heatmap), cputime (heatmap) |
| **Visibility**     | operators and end users                                                                                                      |

This metric shows the execution of SQL statements contained within a query,
and can be used to characterize the workload applied to the database, and to
investigate performance in terms of latency and number of rows the statements
operate on.  These are statements that are executed, and do not contain
queries that return from the query cache (query cache hits).

The "statement" decomposition will show the statement type, such as "select",
"insert", "update", "delete".  The "rowsmatched" decomposition shows the number
of rows matched by the statement: for SELECT this is the number of rows
returned, for INSERT and DELETE the number of rows affected, and for UPDATE
this is the rows matched by the WHERE clause - although they may not be
modified if their value is already set to the new value.  The "rowschanged"
decomposition is only valid for UPDATE, and shows the number of rows that were
actually changed.  The "latency" and "cputime" heatmaps show the distribution
of statement execution time, and can be compared in the same way as with the
queries metric described earlier.


### MySQL: filesort

| Datum              | Value                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **Name**           | mysql.filesort                                                                                   |
| **Raw metric**     | number of database filesorts                                                                     |
| **Decompositions** | hostname, zonename, pid, execname, psargs, database, table, latency (heatmap), cputime (heatmap) |
| **Visibility**     | operators and end users                                                                          |

This shows the filesort operation in MySQL databases, which can be expensive
component of a query, both in terms of CPU time and file system I/O.
Breakdowns provide information on the database and table that were the subject
to filesort.  The latency and cputime fields allow the time spent doing
filesort, and the time spent on-CPU to be examined.  If these heatmaps are
different with "latency" much higher than "cputime", it can indicate that
time is spent waiting on file system I/O (including disk I/O) rather than
performing work on-CPU.

## OS-related metrics

These metrics report information about the state of processes, when they are
created, and when they exit.

### OS: process execs

| Datum              | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| **Name**           | unix.proc_execs                                                                |
| **Raw Metric**     | number of successful process exec operations                                   |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, subsecond |
| **Visibility**     | operators and customers                                                        |

This metric reports each time a process has successfully finished an exec(2) or
equivalent call. This is useful for understanding how often a new process is
being started. Applications that frequently spawn many short lived processes may
see poorer performance. Some applications have options that allow programs to
spawn new threads instead of processes, which may improve performance.

### OS: process exits

| Datum              | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Name**           | unix.proc_exits                                                                          |
| **Raw Metric**     | number of processes exited                                                               |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, subsecond, walltime |
| **Visibility**     | operators and customers                                                                  |

This metric reports each time a process finishes. This is useful for
understanding when processes complete and how long they were running. The
walltime breakdown provides a heatmap of exits based on process runtime. Having
many short lived processes could be symptomatic of performance problems. Having
a daemon (like apache, nginx, sendmail) exit frequently could be symptomatic of
configuration and other errors.

### OS: process forks

| Datum              | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| **Name**           | unix.proc_forks                                            |
| **Raw Metric**     | number of processes forked                                 |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, subsecond |
| **Visibility**     | operators and customers                                    |

This metric reports each time a process forks. When a process forks it may
either be for an exec(2) (see unix.proc_execs) or the child will be used for the
application. If an application is seeing high fork rates, there may be
performance problems. Note, the "ppid" decomposition will be the pid of the
process that called fork(2). "pexecname" and "ppsargs" are not included because
they are identical to "execname" and "psargs".

### OS: thread creations

| Datum              | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| **Name**           | unix.thr_creates                                                               |
| **Raw Metric**     | number of threads created                                                      |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, subsecond |
| **Visibility**     | operators and customers                                                        |

This metric reports each time a thread is created. Several applications create
threads on each request. If an application is regularly creating a high number
of threads per second, that may negatively impact performance.

### OS: processes

| Datum              | Value                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| **Name**           | unix.processes                                                                   |
| **Raw Metric**     | number of process                                                                |
| **Decompositions** | hostname, zonename, execname, pid, ppid, rss, contract, psargs, pmodel, nthreads |

This metric reports the total number of processes on the system. This is useful
for understanding what is running and characteristics of that set.  Decomposing
based upon 'rss' create a heatmap that shows the resident set sizes in use.
This can be used to get an idea of the different amounts of memory use by
different processes. Decomposing by 'execname' is useful for seeing which
applications are most common. 'nthreads' is a heatmap based upon the number of
threads that are in each process. 'pmodel' answers the question of which
processes are 32-bit and which are 64-bit.

## VM-related metrics

The VM metrics report information that is specific to Virtual Machines and not
applicable to SmartMachines. Note that several of the metrics that we have do
apply to both kinds of machines.



## NIC-related metrics

The NIC metrics allow operators and end users to observe network activity as it
relates to physical network cards (system-wide activity) or VNICs (per-zone
activity).


### NIC: NICs

| Datum              | Value                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | nic.nics                                                                                                                                    |
| **Raw metric**     | number of physical NICs                                                                                                                     |
| **Decompositions** | hostname, nic, packets (heatmap), packets\_in (heatmap), packets\_out (heatmap), bytes (heatmap), bytes\_in (heatmap), bytes\_out (heatmap) |
| **Visibility**     | operators only                                                                                                                              |

This raw metric measures the number of physical network cards, which itself may
not be very interesting.  However, the raw value can be decomposed by the number
of packets sent and received or the number of bytes sent and received and the
result viewed as a heatmap, allowing operators to quickly see which NICs are
busy within the datacenter or on a particular server.


### NIC: bytes sent and received

| Datum              | Value                                                |
| ------------------ | ---------------------------------------------------- |
| **Name**           | nic.bytes                                            |
| **Raw metric**     | number of bytes sent and received over physical NICs |
| **Decompositions** | hostname, nic, direction                             |
| **Visibility**     | operators only                                       |

This raw metric measures the number of bytes sent and/or received over physical
network cards, optionally decomposed by hostname, NIC, or direction.


### NIC: packets sent and received

| Datum              | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| **Name**           | nic.packets                                            |
| **Raw metric**     | number of packets sent and received over physical NICs |
| **Decompositions** | hostname, nic, direction                               |
| **Visibility**     | operators only                                         |

This raw metric measures the number of packets sent and/or received over
physical network cards, optionally decomposed by hostname, NIC, or direction.


### NIC: VNIC bytes sent and received

| Datum              | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| **Name**           | nic.vnic_bytes                                        |
| **Raw metric**     | number of bytes sent and received over per-zone VNICs |
| **Decompositions** | hostname, zonename, direction                         |
| **Visibility**     | operators and end users                               |

This raw metric measures the number of bytes sent and/or received by a
particular zone's VNICs, optionally decomposed by hostname, zonename, or
direction.


### NIC: VNIC packets sent and received

| Datum              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| **Name**           | nic.vnic_packets                                        |
| **Raw metric**     | number of packets sent and received over per-zone VNICs |
| **Decompositions** | hostname, zonename, direction                           |
| **Visibility**     | operators and end users                                 |

This raw metric measures the number of packets sent and/or received by a
particular zone's VNICs, optionally decomposed by hostname, zonename, or
direction.


## Node.js-related metrics

The Node.js metrics provide high-level visibility into several types of activity
for Node programs running v0.4.x or later.  Each metric provides fields for
decomposing by host, zone, or application.


### Node.js 0.4.x: garbage collection operations

| Datum              | Value                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| **Name**           | node.gc_ops                                                                                    |
| **Raw metric**     | number of garbage collection operations                                                        |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, gctype, latency (heatmap) |
| **Visibility**     | operators and end users                                                                        |

This metric measures the total number of garbage collection operations for
Node.js programs, optionally decomposed by type of GC (mark-and-sweep or
scavenge).  The "latency" field enables visualizing GC operation time as a
heatmap.


### Node.js 0.4.x: HTTP client operations

| Datum              | Value                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | node.httpc\_ops                                                                                                                           |
| **Raw metric**     | HTTP client operations                                                                                                                    |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, http\_method, http\_url, http\_path, raddr, rport, latency (heatmap) |
| **Visibility**     | operators and end users                                                                                                                   |

This metric measures the total number of HTTP client operations for Node.js
programs, where each operation consists of a request and a response.  The result
can be decomposed by any of several HTTP request properties.  The "latency"
field enables visualizing HTTP client request latency as a heatmap.


### Node.js 0.4.x: HTTP server operations

| Datum              | Value                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | node.httpd\_ops                                                                                                                                         |
| **Raw metric**     | HTTP server operations                                                                                                                                  |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, http\_method, http\_url, http\_path, http\_origin, raddr, rport, latency (heatmap) |
| **Visibility**     | operators and end users                                                                                                                                 |

This metric measures the total number of HTTP server operations for Node.js
programs, where each operation consists of a request and a response.  The result
can be decomposed by any of several HTTP request properties.  The "latency"
field enables visualizing HTTP server request latency as a heatmap.


### Node.js 0.4.x: socket operations

| Datum              | Value                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | node.socket\_ops                                                                                                               |
| **Raw metric**     | socket operations                                                                                                             |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, optype, raddr, rport, size (heatmap), buffered (heatmap) |
| **Visibility**     | operators and end users                                                                                                       |

This metric measures the total number of socket read/write operations for
Node.js programs.  The result can be decomposed by the remote address or port
and the operation type.  The result can be viewed as a heatmap by operation size
(how many bytes were read or written) or by how many bytes are buffered inside
Node.  This last heatmap provides observability into memory usage resulting from
inadequate flow control.


## Syscall-related metrics
### System calls: system calls

| Datum              | Value                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | syscall.syscalls                                                                                                                        |
| **Raw metric**     | number of system calls completed                                                                                                        |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, syscall, subsecond (heatmap), latency (heatmap), cputime (heatmap) |
| **Visibility**     | operators and end users                                                                                                                 |

This raw metric reports the total number of system calls (syscalls), which
represent application requests to the operating system.  Since applications
interface with the filesystem, disks, network, other applications, and the
system itself through syscalls, examining syscalls and syscall latency provides
low-level insight into most forms of application latency.

This metric allows users to examine syscall latency (how long the system call
took) using a heatmap decomposed by host, zone, application, or syscall.  The
"cputime" heatmap presents a similar visualization based on the actual CPU time
used by the syscall rather than elapsed wall clock time.

The "subsecond" heatmap traces the time a syscall was called, showing the time
within a second on the y-axis.  A timed activity that occured once per second
at the same time would appear as a single horizontal line.  One that crept over
time by performing work and then sleeping for a full second would appear as a
diagonal line.  These details can help characterize the syscall workload
performed by application threads.


## TCP-related metrics

The TCP metrics provide visibility into TCP activity and errors.


### TCP: accepts

| Datum              | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| **Name**           | tcp.accepts                                                                       |
| **Raw metric**     | number of TCP connections accepted                                                |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, rport, raddr |
| **Visibility**     | operators and customers                                                           |

This metric reports the number of TCP connections accepted.  For
connection-oriented applications, this metric is useful for understanding new
client activity.  Applications seeing many connections from the same remote
host might consider using a single persistent connection to avoid the overhead
of TCP connection setup and teardown.


### TCP: connects

| Datum              | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| **Name**           | tcp.connects                                                                      |
| **Raw metric**     | number of outbound TCP connections completed                                      |
| **Decompositions** | hostname, zonename, pid, execname, psargs, ppid, pexecname, ppsargs, rport, raddr |
| **Visibility**     | operators and customers                                                           |

This metric reports the number of outbound TCP connections completed.  For
connection-oriented applications, this metric is useful for understanding new
client activity.  Applications seeing many connections to the same remote
host might consider using a single persistent connection to avoid the overhead
of TCP connection setup and teardown.


### TCP: errors

| Datum              | Value                      |
| ------------------ | -------------------------- |
| **Name**           | tcp.errors                 |
| **Raw metric**     | total number of TCP errors |
| **Decompositions** | hostname, errtype          |
| **Visibility**     | operators only             |

This metric reports the number of TCP errors and can be decomposed by the error
type.  Different TCP errors have different underlying causes, all of which can
contribute to application latency.  For example, retransmitted segments indicate
packet loss in the network, which causes application activity to block at least
as long as the configured TCP retransmit timeout (typically multiple seconds).


### TCP: segments

| Datum              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Name**           | tcp.segments                                             |
| **Raw metric**     | total number of TCP segments (packets) sent and received |
| **Decompositions** | hostname, direction                                      |
| **Visibility**     | operators only                                           |

This metric reports the total number of TCP segments (packets) sent and received
and can be used to observe network activity over TCP.


### VM: exits

| Datum             | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| **Name**          | vm.exits                                                   |
| **Raw metric**    | number of times the Virtual Machine exits back to the host |
| **Decomposition** | hostname, zonename, vleavereason, vcpuid                   |
| **Visibility**    | operators only                                             |

This metric measures the number of times a virutal machine must stop running the
guest and handle some operation. Exits can be caused because of disk and network
I/O or by activities external to the guest such as receiving an interrupt on the
same processor. A large number of exits may be symptomatic of poorer
performance.

### VM: interrupt requests

| Datum             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| **Name**          | vm.irqs                                               |
| **Raw Metric**    | number of interrupt requests made by Virtual Machines |
| **Decomposition** | hostname, subsecond, zonename, irqvector              |
| **Visibility**    | operators and end users                               |

This metric measures the raw number of interrupt requests that are being made to
the guest. An interrupt request occurs because of an emulated hardware device
such as a timer, networking interface, or disk drive. This is useful for
understanding how the guest is using its virtualized hardware resources.

### VM: disk I/O operations

| Datum              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Name**           | vm.physio_ops                                            |
| **Raw Metric**     | number of Virtual Machine disk I/O operations completed  |
| **Decompositions** | hostname, zonename, optype, latency, size, offset, errno |
| **Visibility**     | operators and end users                                  |

This metric gives visibility into the I/O Virtual Machines are doing to their
virtual disks. This is the primary metric for understanding Virtual Machine disk
performance.

### VM: disk bytes read and written

| Datum              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Name**           | vm.physio_bytes                                          |
| **Raw Metric**     | number of bytes read or written to Virtual Machine disks |
| **Decompositions** | hostname, zonename, optype                               |
| **Visibility**     | operators and end users                                  |

This metric measures the raw number of bytes read and/or written to virtual
disks provided to Virtual Machines. This allows operators and end users to see
if the virtual disks are being driven to maximum throughput.

### VM: thread samples

| Datum              | Value                                         |
| ------------------ | --------------------------------------------- |
| **Name**           | vm.thread_samples                             |
| **Raw Metric**     | number of samples a thread was running on-CPU |
| **Decompositions** | hostname, zonename, subsecond, vmmuctx        |
| **Visibility**     | operators and end users                       |

This raw metric counts the number of times a vCPU was sampled on-CPU. The
sampling is performed at 99 Hertz (samples per second) per CPU, not 100 Hertz,
to avoid sampling in lockstep with timed activity.

This can be used to understand guest CPU usage at a coarse-grained level. The
vmmuctx decomposition can be used to see what MMU context is active at the time
of sampling. The subsecond heatmap provides the same insights as that in CPU:
thread samples.


## ZFS-related metrics

The ZFS metrics report on the operation of the ZFS filesystem and how disk
space is used by ZFS pools and their filesystems.  Typically, an individual
server will have one or more storage pools, each of which may contain any
number of datasets (filesystems and volumes), each of which may contain any
number of snapshots.  Some of these datasets are used by the system itself,
while the others are allocated to individual zones.  Some metrics report by
dataset or by pool.  Dataset-level metrics provide a "zdataset" field for
decomposing by dataset name, while pool-level metrics provide a "zpool" field
for decomposing by pool name.

ZFS filesystems are not fixed in size: by default, storage for each filesystem
is allocated from a single pool.  Most configurations limit filesystem size by
specifying a quota, which can be observed using the metrics below.  ZFS also
provides reservations, which guarantee space rather than limit it.

The flexibility of ZFS storage configuration makes space accounting complex.  Be
sure to understand all of the concepts and metrics here before drawing
conclusions from these metrics.  See the zfs(1M) man page for details.


### ZFS: ARC operations

| Datum              | Value                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **Name**           | zfs.arc_ops                                                                                   |
| **Raw metric**     | total number of operations on the ARC (adaptive replacement cache)                            |
| **Decompositions** | hostname, zonename, execname, psargs, pid, pexecname, ppsargs, ppid, optype ("hit" or "miss") |
| **Visibility**     | operators and end users                                                                       |

In raw form, this metric reports all ARC hits and misses.  These can be
decomposed by "optype" to identify hits and misses.  Operations can also be
decomposed by the usual process fields (pid, application name, arguments, and
parent process information) to identify processes responsible for ARC
operations.

When filesystem data and metadata is requested, ZFS first looks to satisfy the
request from the in-memory adaptive replacement cache (ARC).  If the request
hits in the cache, it is satisfied immediately.  If the request misses, ZFS
generally must fetch the data from secondary storage, which often takes
significantly more time.  This metric allows users to identify application
latency resulting from reading filesystem data and to measure the overall
efficacy of the cache for their workload.


### ZFS: quota size

| Datum              | Value                           |
| ------------------ | ------------------------------- |
| **Name**           | zfs.dataset_quota               |
| **Raw metric**     | total of all ZFS dataset quotas |
| **Decompositions** | hostname, zdataset              |
| **Visibility**     | operators and end users         |

In raw form, this metric reports the sum of all quotas.  This can be decomposed
by hostname and ZFS dataset.  This metric only applies to datasets with quotas.

It's important to note that the sum of all quotas for a single system is not
related to the total storage on that system.  For one, not all filesystems have
quotas.  Additionally, quotas do not guarantee available space.  Thus, the sum
of quotas could be less than, equal to, or greater than the total space.


### ZFS: unused quota

| Datum              | Value                                   |
| ------------------ | --------------------------------------- |
| **Name**           | zfs.dataset_unused_quota                |
| **Raw metric**     | total unused quota for all ZFS datasets |
| **Decompositions** | hostname, zdataset                      |
| **Visibility**     | operators and end user                  |

In raw form, this metric reports the sum of unused quota for all ZFS datasets.
This can be decomposed by hostname and ZFS dataset.  Like the "quota size"
metric, this metric only applies to datasets with quotas.

This metric is not quite the same as the difference between "quota" and "used
space".  For one, the "used space" metric includes space used by datasets with
no quota configured, which are not counted here.  Additionally, this metric
includes space used by a dataset's children, since that space is counted against
a dataset's quota, while the "used space" metric does not include a dataset's
children (since that's reported separately).

It's also important to remember that since ZFS filesystems allocate from a
common pool of storage, each dataset's unused quota overlaps with that of every
other dataset (unless reservations are being used).  So it's not necessarily
true that the unused quota is space that's available for use.


### ZFS: used space

| Datum              | Value                                 |
| ------------------ | ------------------------------------- |
| **Name**           | zfs.dataset_used                      |
| **Raw metric**     | total used space for all ZFS datasets |
| **Decompositions** | hostname, zdataset                    |
| **Visibility**     | operators and end user                |

In raw form, this metric reports the sum of used space for all ZFS datasets.
This can be decomposed by hostname and ZFS dataset.

The used space for a dataset includes space used by the dataset itself, its
snapshots, and any unused reservation configured on the dataset.  However, this
metric does *not* include space used by child datasets, since they're reported
separately.

See the "ZFS: unused quota" metric for additional details on free space
accounting.


### ZFS: free space in pool

| Datum              | Value                              |
| ------------------ | ---------------------------------- |
| **Name**           | zfs.pool_free                      |
| **Raw metric**     | total free space for all ZFS pools |
| **Decompositions** | hostname, zpool                    |
| **Visibility**     | operators only                     |

In raw form, this metric reports the sum of free space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.


### ZFS: used space in pool

| Datum              | Value                              |
| ------------------ | ---------------------------------- |
| **Name**           | zfs.pool_used                      |
| **Raw metric**     | total used space for all ZFS pools |
| **Decompositions** | hostname, zpool                    |
| **Visibility**     | operators only                     |

In raw form, this metric reports the sum of used space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.


### ZFS: total space in pool

| Datum              | Value                        |
| ------------------ | ---------------------------- |
| **Name**           | zfs.pool_total               |
| **Raw metric**     | total space in all ZFS pools |
| **Decompositions** | hostname, zpool              |
| **Visibility**     | operators only               |

In raw form, this metric reports the sum of all space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.

## Cloud Analytics-related metrics

These metrics provide visibility into the Cloud Analytics service itself.

### CA: instrumenter ticks

| Datum              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Name**           | ca.instr_ticks                                   |
| **Raw metric**     | total number of instrumenter ticks               |
| **Decompositions** | hostname, latency (heatmap), subsecond (heatmap) |
| **Visibility**     | operators only                                   |

This metric counts the number of ticks by all instrumenters in the CA service.
Each instrumenter normally ticks once per second to gather data.  The latency
of each tick measures how long it took the instrumenter to gather data for each
of its instrumentations.  The subsecond offset measures what time within each
second the tick began.  Together, these heatmaps allow administrators to
understand how much time each instrumenter is spending gathering and reporting
data and whether data is being reported on time.

### CA: instrumenter backend operations

| Datum              | Value                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| **Name**           | ca.instr_beops                                                                   |
| **Raw metric**     | total number of instrumenter backend operations                                  |
| **Decompositions** | hostname, cabackend, cainstnid, cametric, latency (heatmap), subsecond (heatmap) |
| **Visibility**     | operators only                                                                   |

This metric counts the number of data requests to instrumenter backends.
During each instrumenter tick (see above), the instrumenter requests data from
some backend for each active instrumentation.  This metric provides visibility
into which instrumenters, backends, instrumentations, and metrics are doing a
lot of work or taking a long time to gather data.  The latency and subsecond
heatmaps work similarly to their counterparts for the "instrumenter ticks"
metric above.

This metric is essentially a more fine-grained view on instrumenter ticks.
It's primarily useful when that metric has already demonstrated that
instrumenters are taking a long time to gather data and you now need to
understand which backends are responsible for that time.

### CA: instrumenter enable operations

| Datum              | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| **Name**           | ca.instr_enables                                            |
| **Raw metric**     | total number of instrumenter enable operations              |
| **Decompositions** | hostname, cabackend, cainstnid, cametric, latency (heatmap) |
| **Visibility**     | operators only                                              |

This metric counts the number of times an instrumenter enables a Cloud
Analytics instrumentation.  Such events are usually triggered when a user
creates an instrumentation for the first time, but they can also occur if an
instrumenter restarts, if a new compute node is deployed, or if a customer
provisions a new machine.  Using the latency heatmap, operators can monitor the
time required to enable an instrumentation on each instrumenter.

This metric is intended for use in supporting Cloud Analytics.  It is not
useful for understanding general system performance.

### CA: instrumenter disable operations

| Datum              | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| **Name**           | ca.instr_disables                                           |
| **Raw metric**     | total number of instrumenter disable operations             |
| **Decompositions** | hostname, cabackend, cainstnid, cametric, latency (heatmap) |
| **Visibility**     | operators only                                              |

This metric counts the number of times an instrumenter disables an
instrumentation.  Such events are usually triggered when a user deletes an
instrumentation.  Using the latency heatmap, operators can monitor the time
required to disable an instrumentation on each instrumenter.

This metric is intended for use in supporting Cloud Analytics.  It is not
useful for understanding general system performance.

### Restify: server operations

| Datum              | Value                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | restify.server_ops                                                                                                                                                         |
| **Raw metric**     | total number of restify server operations                                                                                                                                  |
| **Decompositions** | "hostname", "zonename", "execname", "pid", "ppid", "pexecname", "psargs", "ppsargs", "restify_sname", "restify_rname", "http_url", "http_method", "http_status", "latency" |
| **Visibility**     | operators only                                                                                                                                                             |

This metric counts the number of operations from a Node.js program using
the restify module. The given operations can be broken down on a number
of parameters related to HTTP, the specifics of the restify server, and
basic properties about where it is running. The "latency" heatmap allows
visualizing the response time of the server operations as a heatmap.

### Restify: handler operations

| Datum              | Value                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**           | restify.handler_ops                                                                                                                               |
| **Raw metric**     | total number of restify handler operations                                                                                                        |
| **Decompositions** | "hostname", "zonename", "execname", "pid", "ppid", "pexecname", "psargs", "ppsargs", "restify_sname", "restify_rname", "restify_hname", "latency" |
| **Visibility**     | operators only                                                                                                                                    |

This metric looks at the individual handlers that are used in a Node.js
program with the restify module. Series of handlers make up a given
restify server operation. Valid decompositions include information about
the specific restify route, server, and handler, as well as additional
information about the running environment. Finally, the "latency"
heatmap allows for visualizing the latency of each of the handlers that
run.


# Fields

Fields are used for decomposition and creating predicates.  To see which fields are
provided by which metrics, see "Metrics" above.

## Discrete fields

The values of the following fields are strings. Decomposing by one of these fields
could yield a stacked line graph rather than a single line graph (or, for
individual values, a vector rather than a scalar).

| Field             | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **cabackend**     | backend module                                                                            |
| **cainstnid**     | instrumentation identifier                                                                |
| **cametric**      | metric name                                                                               |
| **client**        | client hostname                                                                           |
| **conntype**      | type of TCP connection, either "active" (client) or "passive"  (server)                   |
| **contract**      | contract identifier                                                                       |
| **cpu**           | CPU identifier (e.g., "cpu0")                                                             |
| **cpumode**       | CPU mode, either "user" or "kernel"                                                       |
| **database**      | database name                                                                             |
| **disk**          | disk identifier                                                                           |
| **direction**     | direction of bytes transferred, either "sent" or "received"                               |
| **errno**         | error code                                                                                |
| **execname**      | application name                                                                          |
| **errtype**       | TCP error description                                                                     |
| **fstype**        | filesystem name (e.g., "zfs")                                                             |
| **gctype**        | type of garbage collection (e.g., "scavenge")                                             |
| **hostname**      | server name                                                                               |
| **http_method**   | HTTP request method (e.g., "GET")                                                         |
| **http_origin**   | Origin IP address for HTTP request, as reported by "X-Forwarded-For" header               |
| **http_path**     | HTTP request URL path (URL without query parameters)                                      |
| **http_status**   | HTTP status code                                                                          |
| **http_url**      | HTTP request URL                                                                          |
| **irqvector**     | IRQ vector                                                                                |
| **ldapbinddn**    | LDAP bind DN                                                                              |
| **ldapfilter**    | LDAP search filter                                                                        |
| **ldaprequestdn** | LDAP request DN                                                                           |
| **ldapscope**     | LDAP search scope                                                                         |
| **leavereason**   | description of why a process came off-CPU                                                 |
| **nic**           | network interface identifier (e.g., "e1000g0")                                            |
| **optype**        | operation type, often "read" or "write" but can be any operation depending on the  metric |
| **pexecname**     | parent process application name                                                           |
| **pid**           | process identifier                                                                        |
| **pmodel**        | process model (e.g., 32-bit, 64-bit)                                                      |
| **ppid**          | parent process identifier                                                                 |
| **psargs**        | process name and arguments                                                                |
| **ppsargs**       | parent process name and arguments                                                         |
| **querysubstr**   | query substring (first 6 characters of the raw query string)                              |
| **raddr**         | remote IP address                                                                         |
| *restify_hname**  | Restify handler name                                                                      |
| *restify_rname**  | Restify route name                                                                        |
| *restify_sname**  | Restify server name                                                                       |
| **rport**         | remote TCP port                                                                           |
| **syscall**       | name of a system call                                                                     |
| **table**         | database table name                                                                       |
| **user**          | client username                                                                           |
| **vcpuid**        | vCPU identifier                                                                           |
| **vleavereason**  | reason leaving vCPU                                                                       |
| **vmmuctx**       | VM MMU context                                                                            |
| **zdataset**      | ZFS dataset name                                                                          |
| **zonename**      | Zone (or SmartMachine or Virtual Machine) name                                            |
| **zpool**         | ZFS pool name                                                                             |

## Numeric fields

The values of the following fields are numbers. Decomposing by one of these fields
typically yields a heatmap rather than a scalar or vector.

| Field           | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| **busytime**    | percent of time spent doing work (e.g., processing I/O)                                   |
| **bytes**       | number of bytes, both read and written                                                    |
| **bytes_read**  | number of bytes read                                                                      |
| **bytes_write** | number of bytes written                                                                   |
| **buffered**    | number of bytes currently buffered in memory                                              |
| **cputime**     | time spent actually on-CPU                                                                |
| **iops**        | I/O operations, both read and write                                                       |
| **iops_read**   | read I/O operations                                                                       |
| **iops_write**  | write I/O operations                                                                      |
| **latency**     | how long an operation took                                                                |
| **offset**      | byte offset within a file or block device                                                 |
| **nthreads**    | number of threads in a process                                                            |
| **packets**     | number of packets sent or received                                                        |
| **packets_in**  | number of packets received                                                                |
| **packets_out** | number of packets sent                                                                    |
| **rss**         | process resident set size                                                                 |
| **runtime**     | time spent running continuously on CPU                                                    |
| **size**        | size in bytes of a packet or operation                                                    |
| **subsecond**   | time offset during a second for when the event occurred                                   |
| **utilization** | percent of overall resource utilized (for CPUs, this is the same as percent of time busy) |
| **walltime**    | total time between program start and finish                                               |

# Appendix A: Version History

Changes in 0.1.8:

* "average" and "percentile" heatmap resources

Changes in 0.1.7:

* "value-scope" property of instrumentations

Changes in 0.1.6:

* "ndatapoints" property of "value" resources and corresponding changes to
  return payloads "end_time" property of "value" resources

Changes in 0.1.5:

* "clone" resource

Changes in 0.1.4:

* "crtime" property of instrumentations
* "nbuckets", "width", "height" payload property for heatmap values
* "requested_start_time" and "requested_duration" payload properties for all
  values

Changes in 0.1.3:

* "id" property of instrumentations

Changes in 0.1.2:

* "persist-data" property of instrumentations

Changes in 0.1.1:

* "granularity" property of instrumentations
* "start_time" and "duration" properties of instrumentation values (rounded to
  multiples of "granularity")

<p style="min-height: 31px; margin-top: 60px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 10px 0">
<a rel="license" href="http://creativecommons.org/licenses/by-nd/3.0/"><img alt="Creative Commons License" style="border-width:0;float:left;margin:4px 8px 0 0;" src="http://i.creativecommons.org/l/by-nd/3.0/88x31.png" /></a> <span xmlns:dct="http://purl.org/dc/terms/" href="http://purl.org/dc/dcmitype/Text" property="dct:title" rel="dct:type">Joyent Cloud Analytics Documentation</span> by <a xmlns:cc="http://creativecommons.org/ns#" href="http://www.joyent.com" property="cc:attributionName" rel="cc:attributionURL">Joyent, Inc.</a> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-nd/3.0/">Creative Commons Attribution-NoDerivs 3.0 Unported License</a>.
</p>
