var TARGET_PACKAGE = "com.agri.video.collector";

function assertAllowedTargetPackage(packageName) {
  if (packageName !== TARGET_PACKAGE) {
    throw new Error("remote_wake_target_not_allowed");
  }
  return packageName;
}

module.exports = {
  TARGET_PACKAGE: TARGET_PACKAGE,
  assertAllowedTargetPackage: assertAllowedTargetPackage
};
