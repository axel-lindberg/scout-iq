import { fireEvent, render, screen } from "@testing-library/react";
import { shirtSourceWidth, shirtUrl } from "../lib/shirts";
import { Shirt } from "./Shirt";

const BASE = "https://fantasy.premierleague.com/dist/img/shirts/standard";

describe("shirts", () => {
  it("builds FPL's URL from the team code, with the goalkeeper kit and a 2x source size", () => {
    expect(shirtUrl(3, false, 40)).toBe(`${BASE}/shirt_3-110.webp`);
    expect(shirtUrl(3, true, 40)).toBe(`${BASE}/shirt_3_1-110.webp`);
    expect([20, 33, 34, 56, 200].map(shirtSourceWidth)).toEqual([66, 66, 110, 220, 220]);
  });

  it("shows the image, and the plain shirt when it fails or there is no code", () => {
    const { container, rerender } = render(<Shirt teamCode={3} size={40} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `${BASE}/shirt_3-110.webp`);
    expect(img).toHaveAttribute("alt", ""); // decorative: the name is next to it
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("shirt-fallback")).toBeInTheDocument();

    rerender(<Shirt teamCode={7} size={40} />); // another team: tries its image again
    expect(container.querySelector("img")).toHaveAttribute("src", `${BASE}/shirt_7-110.webp`);
    rerender(<Shirt teamCode={null} size={40} />);
    expect(screen.getByTestId("shirt-fallback")).toBeInTheDocument();
  });
});
