"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * Kept in its own client chunk because Prism's language registry is expensive
 * to parse and most conversations do not contain a fenced code block.
 */
export function MessageCodeBlock({ language, children }: { language: string; children: string }) {
  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      PreTag="div"
      className="rounded-md! text-xs!"
    >
      {children}
    </SyntaxHighlighter>
  );
}
