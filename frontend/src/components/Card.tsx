import type { ComponentPropsWithoutRef } from "react";

export function Card({ className = "", ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-5 ${className}`}
      {...props}
    />
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-bad">
      {children}
    </p>
  );
}
