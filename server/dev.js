'use strict';
// This entry point explicitly opts into local-only test authentication.
process.env.NODE_ENV='development';
if (process.env.CONTAINER_DEV === '1') process.env.HOST ||= '0.0.0.0';
try {require('./index').start();} catch(error) {console.error(error.message);process.exitCode=1;}
