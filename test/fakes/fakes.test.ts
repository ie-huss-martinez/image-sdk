import { describeImageEngineContract } from "../contracts/image-engine.contract.js";
import { describeImageProcessorContract } from "../contracts/image-processor.contract.js";
import { fakeEngineHarness, fakeProcessorHarness } from "./harness.js";

// The fakes pass the same suites as the real adapters will, which also
// proves the suites themselves. The session's tests will run against them.
describeImageEngineContract("fake engine", fakeEngineHarness);
describeImageProcessorContract("fake processor", fakeProcessorHarness);
