import { useState } from "react";

export const CommitPicker: React.FC<{
  onSubmit: (commit: string) => void;
  disabled: boolean;
  placeholder: string;
}> = ({ onSubmit, disabled, placeholder }) => {
  const [commit, setCommit] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setCommit("");
        onSubmit(commit);
      }}
    >
      <label>
        Enter an Arbitrary Commit
        <input
          placeholder={placeholder}
          disabled={disabled}
          type="text"
          required
          value={commit}
          onChange={(e) => setCommit(e.target.value)}
        />
      </label>
    </form>
  );
};
