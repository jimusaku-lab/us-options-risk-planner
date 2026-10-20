import { Clipboard } from "lucide-react";

/** Derive the Saxo Portal registration form from a local runtime callback URI.
 * Saxo's PKCE registration omits localhost's port; the running helper still
 * receives the callback on its configured port.
 */
export function deriveSaxoPortalRegistrationUri(runtimeCallbackUri: string): string | null {
  try {
    const callback = new URL(runtimeCallbackUri);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (
      callback.protocol !== "http:" ||
      !loopbackHosts.has(callback.hostname.toLowerCase()) ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash
    ) return null;
    callback.port = "";
    return `${callback.origin}${callback.pathname}`;
  } catch {
    return null;
  }
}

export function SaxoCallbackUriSetup({
  runtimeCallbackUri,
  onCopyPortalRegistrationUri,
}: {
  runtimeCallbackUri: string;
  onCopyPortalRegistrationUri: (uri: string) => void;
}) {
  const portalRegistrationUri = deriveSaxoPortalRegistrationUri(runtimeCallbackUri);
  return (
    <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
      <div className="text-xs font-bold text-slate-700">Saxo Developer Portal登録用 Redirect URI（ポートなし）</div>
      {portalRegistrationUri ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs text-slate-900">{portalRegistrationUri}</code>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-800"
            onClick={() => onCopyPortalRegistrationUri(portalRegistrationUri)}
          >
            <Clipboard size={13} />
            Portal登録用URLをコピー
          </button>
        </div>
      ) : (
        <p role="status" className="mt-1 text-xs text-amber-800">Portal登録用URLを安全に判定できません。loopback callback設定を確認してください。</p>
      )}
      <p className="mt-2 text-xs font-bold text-slate-700">ローカルhelper実行時の callback URL（ポートあり）</p>
      <code className="mt-1 block break-all rounded bg-slate-100 px-2 py-1 text-xs text-slate-900">{runtimeCallbackUri}</code>
      <p className="mt-1 text-xs leading-5 text-slate-600">Portal登録用はポートを付けません。実行時はhelperのポートで受信します。両方ともhostとpathは一致します。</p>
    </div>
  );
}
