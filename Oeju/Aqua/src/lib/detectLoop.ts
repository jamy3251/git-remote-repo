// 인식 요청 스케줄러. 서버 왕복(약 1초) 동안 놀지 않도록 요청을 겹쳐 보낸다.
// - 요청 사이 간격은 gapMs 이상
// - 동시에 maxInFlight 개까지 (첫 응답 전에는 1개: 모델이 깨어나는 중에 몰아치지 않게)

export interface LoopOptions {
  /** 한 프레임을 보내고 응답을 처리한다. 보낼 프레임이 없으면 false */
  send: () => Promise<boolean | void>;
  /** 지금 보내도 되는지 (화면이 가려졌거나 포획 시트가 열려 있으면 false) */
  canSend: () => boolean;
  gapMs: number;
  maxInFlight: number;
  tickMs?: number;
}

export function startDetectLoop(opts: LoopOptions): () => void {
  let alive = true;
  let inFlight = 0;
  let lastSent = -Infinity;
  let warm = false;
  let timer: ReturnType<typeof setTimeout>;

  const tick = () => {
    if (!alive) return;
    const limit = warm ? opts.maxInFlight : 1;
    const now = Date.now();
    if (opts.canSend() && inFlight < limit && now - lastSent >= opts.gapMs) {
      lastSent = now;
      inFlight++;
      opts
        .send()
        .then((sent) => {
          if (sent !== false) warm = true;
        })
        .catch(() => {})
        .finally(() => {
          inFlight--;
        });
    }
    timer = setTimeout(tick, opts.tickMs ?? 50);
  };
  tick();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}
