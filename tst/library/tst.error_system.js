/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.error_system.js: test caSystemError
 */

var mod_assert = require('assert');
var mod_fs = require('fs');
var mod_ca = require('../../lib/ca/ca-common.js');

var re = new RegExp(process.env['SRC'], 'g');
var exn;

console.log('TEST: EEXIST error');
try {
	mod_fs.statSync('/betternotexist');
} catch (ex) {
	exn = new caSystemError(ex, 'ca stat failed');
}

mod_assert.ok(exn);
mod_assert.ok(exn instanceof caSystemError);
mod_assert.equal(exn.code(), ECA_NOENT);
mod_assert.equal(exn.syscode(), 'ENOENT');
console.log(caSprintf('%r', exn).replace(re, '...'));

console.log('TEST: ENOENT error');
try {
	mod_fs.mkdirSync('/', 0777);
} catch (ex) {
	exn = new caSystemError(ex, 'ca mkdir failed');
}

mod_assert.ok(exn);
mod_assert.ok(exn instanceof caSystemError);
mod_assert.equal(exn.code(), ECA_EXISTS);
mod_assert.equal(exn.syscode(), 'EEXIST');
console.log(caSprintf('%r', exn).replace(re, '...'));
