// An unsigned beta still needs a signature on Apple
// Silicon: the kernel refuses to run arm64 code with
// a broken one, and packaging changes the bundle
// Electron shipped signed. An ad-hoc signature
// ("-") is free and enough to run once the person
// has cleared the download's quarantine flag.
//
// Once there is an Apple Developer identity, set
// mac.identity in electron-builder.yml and this step
// stands aside.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return;
  }

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", app],
    { stdio: "inherit" }
  );
};
