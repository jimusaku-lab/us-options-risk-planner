import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

type BackToTopButtonProps = {
  targetId?: string;
  label?: string;
  threshold?: number;
};

export function BackToTopButton({ targetId, label = "上に戻る", threshold = 360 }: BackToTopButtonProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const nextVisible = window.scrollY > threshold;
      setIsVisible((current) => (current === nextVisible ? current : nextVisible));
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, [threshold]);

  const scrollToTop = () => {
    const target = targetId ? document.getElementById(targetId) : undefined;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!isVisible) return null;

  return (
    <button
      type="button"
      className="fixed bottom-4 right-3 z-40 inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-lg transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500 sm:bottom-6 sm:right-4"
      aria-label={label}
      onClick={scrollToTop}
    >
      <ArrowUp size={16} />
      <span>{label}</span>
    </button>
  );
}
