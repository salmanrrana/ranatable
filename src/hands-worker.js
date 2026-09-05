// Classic worker: MediaPipe's pinned WASM loader uses importScripts internally.
// Inference stays off the UI thread, including the CPU fallback.
const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
let landmarker;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const { FilesetResolver, HandLandmarker } = await import(`${VISION_CDN}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
      // Software WebGL can initialize successfully but take seconds per
      // frame. Use the CPU delegate when hardware acceleration is absent.
      const probe = data.delegate === 'CPU' ? null : new OffscreenCanvas(1, 1).getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      const info = probe?.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
      const hardwareGPU = probe && !/swiftshader|llvmpipe|software/i.test(renderer);
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
      const create = (delegate) => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try { landmarker = await create(hardwareGPU ? 'GPU' : 'CPU'); }
      catch { landmarker = await create('CPU'); }
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    }
    return;
  }
  if (data.type === 'frame') {
    const start = performance.now();
    try {
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ type: 'result', result, generation: data.generation,
        timestamp: data.timestamp, inferenceMs: performance.now() - start });
    } catch (error) {
      self.postMessage({ type: 'frame-error', message: error.message });
    } finally { data.bitmap.close(); }
  }
};
