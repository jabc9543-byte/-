import { useEffect, useState } from "react";
import {
  getCurrentPermissionRequest,
  resolvePermission,
  subscribePermissionDialog,
} from "../utils/permissionConfirm";

export function PermissionDialogHost() {
  const [, setTick] = useState(0);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    return subscribePermissionDialog(() => {
      setRemember(false);
      setTick((n) => n + 1);
    });
  }, []);

  const req = getCurrentPermissionRequest();
  if (!req) return null;

  return (
    <div className="perm-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="perm-dialog">
        <h2 className="perm-dialog-title">{req.title}</h2>
        <p className="perm-dialog-desc">{req.description}</p>
        {req.details && <p className="perm-dialog-details">{req.details}</p>}
        {req.rememberKey && (
          <label className="perm-dialog-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>下次不再询问</span>
          </label>
        )}
        <div className="perm-dialog-actions">
          <button
            type="button"
            className="perm-dialog-btn"
            onClick={() => resolvePermission(false)}
          >
            {req.cancelLabel ?? "拒绝"}
          </button>
          <button
            type="button"
            className="perm-dialog-btn perm-dialog-btn-primary"
            onClick={() => resolvePermission(true, remember)}
          >
            {req.confirmLabel ?? "同意"}
          </button>
        </div>
      </div>
    </div>
  );
}
