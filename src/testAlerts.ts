import { createAlertSenders } from "./alertSender.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const senders = createAlertSenders(config);
const testMessage = `Hello from Home Energy Monitor config test at ${new Date().toISOString()}.`;

console.log(`Testing ${senders.length} enabled alert channel(s): ${senders.map((sender) => sender.name).join(", ")}`);

let failures = 0;

for (const sender of senders) {
  try {
    await sender.send({
      key: "config-test",
      device: "solaredge",
      message: testMessage
    });
    console.log(`OK: ${sender.name}`);
  } catch (error: unknown) {
    failures += 1;
    console.error(`FAILED: ${sender.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
