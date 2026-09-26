'use strict';
// This entry point explicitly opts into local-only test authentication.
process.env.NODE_ENV='development';
try {require('./index').start();} catch(error) {console.error(error.message);process.exitCode=1;}
