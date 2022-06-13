import { useState } from "react";
import { BrandHeader } from "./BrandHeader";
import { SpecGrid } from "./SpecGrid";

export const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  return (
    <>
      <main>
        <BrandHeader
          title="Playwright"
          subtitle="Test Status"
          shimmer={isLoading}
        />
        <SpecGrid onLoadingChange={setIsLoading} />
      </main>
    </>
  );
};
