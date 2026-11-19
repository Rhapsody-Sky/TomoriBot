self.onmessage = ({ data }) => {
  try {
    self.postMessage(new RegExp(data.pattern, "iu").test(data.text));
  } catch {
    self.postMessage(null);
  }
};
