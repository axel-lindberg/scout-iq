import type { RouteObject } from "react-router";
import { MyTeamPage } from "../pages/MyTeamPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ScoutPage } from "../pages/ScoutPage";
import { Layout } from "./Layout";

/**
 * Every page of the app. To add one, add a route here; FastAPI already serves
 * index.html for any non-API path, so deep links work in production too.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ScoutPage /> },
      { path: "my-team", element: <MyTeamPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
