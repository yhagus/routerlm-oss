// Custom provider logos are stored as data URLs in the database. Raster images
// are downscaled to a small PNG so each logo stays a few kilobytes.
const LOGO_SIZE = 128;
const MAX_SVG_BYTES = 100_000;
const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

export const LOGO_ACCEPT = ACCEPTED_TYPES.join(",");

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the image file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The file is not a valid image"));
    image.src = src;
  });
}

export async function readLogoFile(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type))
    throw new Error("Use a PNG, JPEG, WebP, GIF or SVG image");
  if (file.type === "image/svg+xml") {
    if (file.size > MAX_SVG_BYTES) throw new Error("SVG logo must be 100 KB or smaller");
    return readAsDataUrl(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, LOGO_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to process the image");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
