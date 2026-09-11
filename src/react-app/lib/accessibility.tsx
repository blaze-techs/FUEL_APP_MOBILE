/**
 * FuelPro Accessibility (A11y) Utilities
 * WCAG 2.2 AA Compliance
 */

import React, { useEffect, useRef, useState } from "react";

// Skip to main content link
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      style={{
        position: "absolute",
        left: "-9999px",
        zIndex: 9999,
        padding: "1em",
        background: "#f59e0b",
        color: "#000",
        textDecoration: "none",
        fontWeight: "bold",
      }}
      onFocus={(e) => {
        e.currentTarget.style.left = "0";
        e.currentTarget.style.top = "0";
      }}
      onBlur={(e) => {
        e.currentTarget.style.left = "-9999px";
      }}
    >
      Skip to main content
    </a>
  );
}

// Focus trap for modals
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    firstElement?.focus();

    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

  return containerRef;
}

// Announce to screen readers
export function useAnnounce() {
  const announceRef = useRef<HTMLDivElement>(null);

  const announce = (
    message: string,
    priority: "polite" | "assertive" = "polite",
  ) => {
    if (!announceRef.current) return;

    announceRef.current.setAttribute("aria-live", priority);
    announceRef.current.textContent = message;

    setTimeout(() => {
      if (announceRef.current) announceRef.current.textContent = "";
    }, 1000);
  };

  return { announceRef, announce };
}

// Screen reader announcement region
export function AnnouncerRegion() {
  const ref = useAnnounce().announceRef;

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    />
  );
}

// Keyboard navigation helper
export function useKeyboardNavigation(
  items: number,
  onSelect: (index: number) => void,
) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % items);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + items) % items);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(focusedIndex);
        break;
      case "Home":
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIndex(items - 1);
        break;
    }
  };

  return { focusedIndex, handleKeyDown, setFocusedIndex };
}

// Color contrast checker
export function getContrastRatio(color1: string, color2: string): number {
  const getLuminance = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;

    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Accessible color combinations (AA compliant)
export const accessibleColors = {
  // Text on dark backgrounds (min 4.5:1 ratio)
  darkText: {
    primary: "#ffffff", // on #1a1a2e
    secondary: "#d1d5db", // on #1a1a2e
    disabled: "#9ca3af", // on #1a1a2e
  },
  // Text on light backgrounds (min 4.5:1 ratio)
  lightText: {
    primary: "#1f2937", // on #f3f4f6
    secondary: "#4b5563", // on #f3f4f6
    disabled: "#9ca3af", // on #f3f4f6
  },
  // Interactive elements (min 3:1 for large text)
  interactive: {
    primary: "#f59e0b", // button backgrounds
    secondary: "#3b82f6", // links
    success: "#10b981", // success states
    error: "#ef4444", // error states
  },
};

// Reduced motion hook
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

// High contrast mode hook
export function useHighContrast(): boolean {
  const [isHighContrast, setIsHighContrast] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-contrast: more)");
    setIsHighContrast(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsHighContrast(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return isHighContrast;
}

// Accessible button with loading state
interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
}

export function AccessibleButton({
  loading,
  loadingText,
  disabled,
  children,
  ...props
}: AccessibleButtonProps) {
  const isLoading = loading || false;
  const loadingLabel = loadingText || "Loading...";

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-disabled={disabled || isLoading}
      style={{
        ...props.style,
        opacity: disabled || isLoading ? 0.6 : 1,
        cursor: disabled || isLoading ? "not-allowed" : "pointer",
        ...props.style,
      }}
    >
      {isLoading && (
        <>
          <span className="sr-only">{loadingLabel}</span>
          {/* Spinner */}
          <svg
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              marginRight: 8,
              animation: "spin 1s linear infinite",
            }}
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
              strokeDasharray="31.4 31.4"
            />
          </svg>
        </>
      )}
      {children}
    </button>
  );
}

// Accessible form field wrapper
interface FormFieldProps {
  label: string;
  id: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function FormField({
  label,
  id,
  error,
  required,
  children,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const descId = `${id}-desc`;

  return (
    <div style={{ marginBottom: 16 }}>
      <label
        htmlFor={id}
        style={{
          display: "block",
          marginBottom: 6,
          fontWeight: 500,
          color: error ? "#ef4444" : "#fff",
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#ef4444", marginLeft: 4 }}>
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </label>

      {children}

      {error && (
        <p
          id={errorId}
          role="alert"
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "#ef4444",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// Screen reader only text
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {children}
    </span>
  );
}

// Export all utilities
export const a11y = {
  SkipToContent,
  useFocusTrap,
  useAnnounce,
  AnnouncerRegion,
  useKeyboardNavigation,
  getContrastRatio,
  accessibleColors,
  useReducedMotion,
  useHighContrast,
  AccessibleButton,
  FormField,
  VisuallyHidden,
};

export default a11y;
