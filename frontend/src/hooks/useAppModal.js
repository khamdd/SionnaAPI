import { useCallback, useState } from "react";

export default function useAppModal() {
  const [content, setContent] = useState(null);
  const [previewLoadCount, setPreviewLoadCount] = useState(0);

  const handlePreviewLoadingChange = useCallback((active) => {
    setPreviewLoadCount((current) =>
      Math.max(0, current + (active ? 1 : -1)),
    );
  }, []);

  const close = useCallback(() => {
    setContent(null);
    setPreviewLoadCount(0);
  }, []);

  return {
    close,
    content,
    handlePreviewLoadingChange,
    previewLoadCount,
    setContent,
  };
}
