import { ReactNode } from "react";

interface EnhancedCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "glass" | "gradient";
  title?: string;
  icon?: ReactNode;
  padding?: "sm" | "md" | "lg";
  hover?: boolean;
  shadow?: "none" | "sm" | "md" | "lg";
}

export default function EnhancedCard({
  children,
  className = "",
  variant = "default",
  title,
  icon,
  padding = "md",
  hover = false,
  shadow = "sm",
}: EnhancedCardProps) {
  const baseStyles = "rounded-lg";

  const paddingStyles = {
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  const shadowStyles = {
    none: "",
    sm: "shadow-sm",
    md: "shadow-md",
    lg: "shadow-lg",
  };

  const variantStyles = {
    default:
      "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700",
    glass:
      "bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700",
    gradient: "bg-gradient-to-br",
  };

  const hoverStyles = hover ? "transition-transform hover:scale-105" : "";

  return (
    <div
      className={`${baseStyles} ${paddingStyles[padding]} ${variantStyles[variant]} ${shadowStyles[shadow]} ${hoverStyles} ${className}`}
    >
      {(title || icon) && (
        <div className="flex items-center gap-2 mb-4">
          {icon && (
            <div className="text-blue-600 dark:text-blue-400">{icon}</div>
          )}
          {title && (
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
