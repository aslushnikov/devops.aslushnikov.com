export const BrandHeader: React.FC<{
  title: string;
  subtitle?: string;
  shimmer?: boolean;
}> = ({ title, subtitle, shimmer }) => {
  return (
    <header>
      <h1 className="brandmark">
        <span className={`gradient ${shimmer ? "shimmer" : ""}`}>
          {title} {subtitle && <span className="subtitle">{subtitle}</span>}
        </span>
      </h1>
    </header>
  );
};
