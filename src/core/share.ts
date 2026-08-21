/**
 * Share bridge. The File System inspector can hand a browsed sandbox file to
 * another app through the library's own native TurboModule (`shareFile`) — no
 * `react-native-share` peer dependency. When the native module isn't available
 * (tests / web / Expo Go) sharing is a no-op and the UI hides the affordance.
 */

import NativeBesouro from '../native/NativeBesouro';
import { mimeTypeOf } from '../shared/utils/mime-types';

/** Whether sharing is available — the UI hides the share affordance when false. */
export function isShareAvailable(): boolean {
  return NativeBesouro != null;
}

/**
 * Present the OS share sheet for the file at `path` if sharing is available;
 * a no-op (false) otherwise. The MIME type is derived from the file's extension
 * (Android labels the payload with it; iOS infers its own from the extension).
 */
export function shareFile(path: string): boolean {
  if (!NativeBesouro) return false;
  try {
    // try/catch guards the call itself (native presentation can fail); method
    // presence is guaranteed by codegen once the module is non-null.
    NativeBesouro.shareFile(path, mimeTypeOf(path));
    return true;
  } catch {
    return false;
  }
}

/**
 * Share a captured response image, passed as the `data:` uri the Network
 * inspector stores it in — there is no file behind it for {@link shareFile} to
 * point at. The payload is decoded natively into a temporary copy that the
 * platform cleans up (see the native `shareBase64File`). Returns false when
 * sharing is unavailable or the uri carries no base64 payload.
 *
 * The filename is deliberately fixed per media type rather than per request: on
 * Android the temporary copy can only be swept, not deleted after the share, so
 * reusing one name means a repeat share overwrites it instead of leaving a trail.
 */
export function shareImage(imageDataUri: string): boolean {
  if (!NativeBesouro) return false;
  const marker = ';base64,';
  const markerIndex = imageDataUri.indexOf(marker);
  if (!imageDataUri.startsWith('data:') || markerIndex === -1) return false;

  const mimeType = imageDataUri.slice('data:'.length, markerIndex);
  const base64 = imageDataUri.slice(markerIndex + marker.length);
  if (base64.length === 0) return false;

  try {
    NativeBesouro.shareBase64File(
      base64,
      `devtools-image.${extensionForMimeType(mimeType)}`,
      mimeType
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Extension for a media type, so the shared file is named something the receiving
 * app recognizes (iOS infers the UTI from it). Falls back to the subtype itself,
 * which is already the right answer for png/gif/webp/bmp/heic.
 */
function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? '';
  if (subtype === 'jpeg') return 'jpg';
  return /^[a-z0-9]+$/.test(subtype) ? subtype : 'bin';
}
