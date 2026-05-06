import { render, screen } from "@testing-library/react";
import { ConnectionStatusBanner } from "@/features/integrations/ConnectionStatusBanner";

describe("ConnectionStatusBanner", () => {
  it("renders nothing when there are no relevant params", () => {
    const { container } = render(<ConnectionStatusBanner searchParams={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a success status when integration=connected", () => {
    render(
      <ConnectionStatusBanner
        searchParams={{ integration: "connected", provider: "slack" }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/connected to slack/i);
  });

  it("renders a generic provider when no provider param is supplied", () => {
    render(<ConnectionStatusBanner searchParams={{ integration: "connected" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/connected to the provider/i);
  });

  it("renders a humanized error when integration_error is set", () => {
    render(
      <ConnectionStatusBanner
        searchParams={{ integration_error: "user denied access" }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/connection failed: user denied access/i);
  });

  it("ignores empty-string params", () => {
    const { container } = render(
      <ConnectionStatusBanner searchParams={{ integration: "", integration_error: "" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores array-shaped params (Next can produce these)", () => {
    const { container } = render(
      <ConnectionStatusBanner
        searchParams={{ integration: ["connected", "twice"] as string[] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
