function buildDetailSignature(textValue) {
  return String(textValue || "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 360);
}

module.exports = {
  buildDetailSignature: buildDetailSignature
};
