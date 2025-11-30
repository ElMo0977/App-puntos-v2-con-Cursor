import { render, screen } from "@testing-library/react";
import NumInput from "../src/components/NumInput";

test("muestra el valor inicial", () => {
  render(<NumInput value={1.2} onCommit={() => {}} />);
  expect(screen.getByDisplayValue("1.2")).toBeInTheDocument();
});
