import { ReactNode, ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

interface EnhancedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  variant?:
    "primary" | "secondary" | "outline" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
}

export default function EnhancedButton({
  children,
  icon,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...props
}: EnhancedButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all";

  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3 text-lg",
  };

  const variantStyles = {
    primary:
      "bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:bg-blue-400",
    secondary:
      "bg-gray-600 hover:bg-gray-700 text-white shadow-sm disabled:bg-gray-400",
    outline:
      "border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50",
    success:
      "bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:bg-green-400",
    warning:
      "bg-yellow-600 hover:bg-yellow-700 text-white shadow-sm disabled:bg-yellow-400",
    danger:
      "bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-red-400",
  };

  const widthStyles = fullWidth ? "w-full" : "";

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
