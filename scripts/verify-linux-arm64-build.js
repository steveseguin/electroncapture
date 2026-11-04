#!/usr/bin/env node
'use strict';
// Preserve the existing direct-script entry point.
require('./verify-linux-build').verify('arm64').catch(error => {
  console.error(error);
  process.exitCode = 1;
});
