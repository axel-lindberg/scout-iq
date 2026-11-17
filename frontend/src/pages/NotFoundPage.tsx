import { Link } from "react-router";
import { Card } from "../components/Card";

export function NotFoundPage() {
  return (
    <Card aria-labelledby="nf-h" className="mx-auto max-w-lg text-center">
      <h2 id="nf-h" className="heading mb-2 text-2xl">
        Page not found
      </h2>
      <p className="mb-4 text-muted">There's nothing at this address.</p>
      <Link to="/" className="btn btn-primary">
        Back to predictions
      </Link>
    </Card>
  );
}
