// test_extension.js - Main AP-Solver Verification Entrypoint (runs all modular test suites)
import { runBackgroundTests } from './tests/test_background.js';
import { runUtilsTests } from './tests/test_utils.js';
import { runContentTests } from './tests/test_content.js';
import { runE2ELoopTests } from './tests/test_e2e_loop.js';

console.log('🧪 Starting AP-Solver Modular Verification...\n');

await runBackgroundTests();
await runUtilsTests();
await runContentTests();
await runE2ELoopTests();

console.log('\n🎉 ALL MODULAR TEST SUITES PASSED! AP-Solver is ready for installation and use.');
