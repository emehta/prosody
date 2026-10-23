export const MAX_SECONDS=30;
export const MIN_SECONDS=.25;
export const MAX_FILE_BYTES=100*1024*1024;
// Estimated compressed input copies + decoded channels + selected mono PCM.
// Reject before decodeAudioData can allocate an unbounded AudioBuffer.
export const MAX_UPLOAD_WORK_BYTES=128*1024*1024;
export const MAX_UPLOAD_HEADER_BYTES=2*1024*1024;
