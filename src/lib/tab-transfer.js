// The tab transfer crypto lives in electron/tab-transfer.js, because the
// packaged application ships only the dist, electron, and assets directories and
// a module under src/ is simply absent at runtime. This file exists so renderer
// code can import it by a stable path, and it deliberately holds no logic of its
// own, which is what keeps the interface and the main process using one
// implementation rather than two that drift apart.
export {
  MIN_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
  assertUsablePassphrase,
  openPayload,
  randomId,
  sealPayload,
  tabPayload,
} from '../../electron/tab-transfer';
