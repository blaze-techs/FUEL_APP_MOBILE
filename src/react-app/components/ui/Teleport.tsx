import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into `document.body` via a React portal.
 *
 * WHY THIS EXISTS: a `position: fixed` element's containing block is its
 * nearest POSITIONED ancestor, not the viewport. Modals rendered inside a
 * positioned container (e.g. `<header class="relative z-40">` or a
 * `<nav class="fixed ...">`) get trapped/clipped to that container's box —
 * the classic "modal hidden above the header" bug. Teleporting to <body>
 * guarantees the overlay covers the viewport and stacks above everything.
 */
export default function Teleport({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
