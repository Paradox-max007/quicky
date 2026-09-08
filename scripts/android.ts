import { spawnSync } from "child_process";
import path from "path";

const localAppData = process.env.LOCALAPPDATA || "";
const sdkPath = path.join(localAppData, "Android", "Sdk");
const platformTools = path.join(sdkPath, "platform-tools");
const adb = path.join(platformTools, "adb.exe");
const javaHome =
  process.env.JAVA_HOME || "C:\\Program Files\\Android\\Android Studio\\jbr";

const env = {
  ...process.env,
  ANDROID_HOME: sdkPath,
  JAVA_HOME: javaHome,
  // Prepend to PATH so child processes (gradle, etc.) can also find tools
  PATH: `${platformTools};${path.join(javaHome, "bin")};${process.env.PATH || ""}`,
};

const action = process.argv[2] || "devices";

function run(cmd: string, args: string[]) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    env,
    stdio: "inherit",
    // Do NOT use shell:true — pass full paths and let spawnSync exec directly
    shell: false,
  });
  if (result.error) {
    console.error(`Failed to run: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== null && result.status !== 0) {
    process.exit(result.status);
  }
}

if (action === "devices") {
  run(adb, ["devices"]);
} else if (action === "run") {
  run(adb, ["reverse", "tcp:3000", "tcp:3000"]);
  const extraArgs = process.argv.slice(3);
  // bunx is a bun binary — resolve it via PATH normally with shell:false
  const bunx = process.execPath; // reuse current bun runtime
  run(bunx, ["x", "cap", "run", "android", ...extraArgs]);
} else if (action === "install") {
  run(adb, [
    "install",
    "-r",
    "android/app/build/outputs/apk/debug/app-debug.apk",
  ]);
  run(adb, [
    "shell",
    "am",
    "start",
    "-n",
    "com.quicky.app/com.quicky.app.MainActivity",
  ]);
} else {
  console.error(`Unknown action: ${action}`);
  process.exit(1);
}
