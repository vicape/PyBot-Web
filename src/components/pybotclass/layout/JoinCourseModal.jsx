import { useJoinCourse } from "./useJoinCourse.js";
import JoinCourseForm from "./JoinCourseForm.jsx";

export default function JoinCourseModal({ open, onClose, supabase, onJoined }) {
  const { code, setCode, busy, msg, err, submit } = useJoinCourse({
    supabase,
    onJoined,
    onClose,
    navigateReplace: false,
    successDelayMs: 800,
  });

  if (!open) return null;

  return (
    <div className="pbc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pbc-modal"
        role="dialog"
        aria-labelledby="join-course-title"
        onClick={(e) => e.stopPropagation()}
      >
        <JoinCourseForm
          code={code}
          onCodeChange={setCode}
          busy={busy}
          err={err}
          msg={msg}
          onSubmit={submit}
          onCancel={onClose}
          showCancel
          autoFocus
        />
      </div>
    </div>
  );
}
