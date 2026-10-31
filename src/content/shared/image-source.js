// Fetch does not support Google's filesystem: image URLs. Resolve their file
// entries in the document origin instead, preserving the original image bytes.
export function readFilesystemImage(url) {
  const source = new URL(url.slice('filesystem:'.length));
  if (source.origin !== location.origin || !['https:', 'http:'].includes(source.protocol)) {
    return Promise.reject(new Error('Image belongs to a different document origin'));
  }
  return new Promise((resolve, reject) => {
    if (typeof window.webkitResolveLocalFileSystemURL !== 'function') {
      reject(new Error('Browser filesystem images are unavailable'));
      return;
    }
    window.webkitResolveLocalFileSystemURL(url, entry => {
      if (!entry.isFile) { reject(new Error('Image source is not a file')); return; }
      entry.file(resolve, reject);
    }, reject);
  });
}
