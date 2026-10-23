import {checkSlot, floatWav, makeTake, microphoneSettings} from './data.js?v=20';

// A new permission request never touches any committed recording.
export class StudyRecorder {
  constructor(microphone, {onChange = () => {}, onTake = async () => {}, onError = () => {}, now = () => performance.now(), environment = () => ({})} = {}) {
    this.microphone = microphone; this.onChange = onChange; this.onTake = onTake;
    this.onError = onError; this.now = now; this.environment = environment;
    this.active = null; this.epoch = 0;
  }

  async start(accent, promptId) {
    if (this.active) return;
    checkSlot(accent, promptId);
    const active = {id: ++this.epoch, accent, promptId, phase: 'starting', chunks: [], rate: 0};
    this.active = active; this.onChange();
    try {
      const started = await this.microphone.start(active.id, {
        onStart: rate => {
          if (this.active !== active) return;
          clearTimeout(active.startTimer); active.rate = rate; active.phase = 'recording';
          active.started = this.now(); active.captureStartedAt = new Date().toISOString();
          active.settings = microphoneSettings(this.microphone.stream);
          this.onChange();
        },
        onChunk: (samples, rate) => {
          if (this.active !== active) return;
          active.rate = rate; active.chunks.push(samples);
        },
        onStop: () => { this.finish(active).catch(error => this.fail(active, error)); },
      });
      if (this.active !== active) return;
      if (!started) { await this.cancel(); return; }
      if (active.phase === 'starting') active.startTimer = setTimeout(() => {
        this.fail(active, new Error('The microphone opened but did not start delivering audio. Try again.'));
      }, 5000);
    } catch (error) { await this.fail(active, error); }
  }

  stop(interrupted = false) {
    const active = this.active;
    if (!active || active.phase !== 'recording') return;
    active.phase = 'stopping'; active.interrupted = interrupted; this.onChange();
    // Keep delivered samples if a device disappears before its stop acknowledgement.
    active.stopTimer = setTimeout(() => {
      active.interrupted = true;
      this.finish(active).catch(error => this.fail(active, error));
    }, 3000);
    this.microphone.stop();
  }

  async finish(active) {
    if (this.active !== active || active.phase === 'saving') return;
    clearTimeout(active.startTimer); clearTimeout(active.stopTimer);
    active.phase = 'saving'; this.onChange();
    const audio = floatWav(active.chunks, active.rate);
    const take = makeTake(active.accent, active.promptId, audio, {
      settings: active.settings, captureStartedAt: active.captureStartedAt,
      interrupted: !!active.interrupted, ...this.environment(),
    });
    active.chunks = [];
    await this.microphone.release();
    // The caller keeps the draft if its persistence attempt fails.
    await this.onTake(take);
    if (this.active === active) { this.active = null; this.onChange(); }
  }

  async cancel() {
    const active = this.active;
    if (!active || active.phase !== 'starting') return;
    this.active = null; this.epoch++;
    clearTimeout(active.startTimer); this.onChange(); await this.microphone.release();
  }

  async fail(active, error) {
    if (this.active !== active) return;
    clearTimeout(active.startTimer); clearTimeout(active.stopTimer);
    this.active = null; this.epoch++; await this.microphone.release();
    this.onError(error); this.onChange();
  }
}
