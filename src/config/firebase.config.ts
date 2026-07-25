import firebase from "firebase-admin";
import type { ClientApp } from "../types/client-app.type";
import { Env } from "../utils/env.util";

type FirebaseCredentials = {
  clientEmail?: string;
  privateKey?: string;
  projectId?: string;
};

const firebaseApps = new Map<ClientApp, firebase.app.App>();

function getFirebaseCredentials(clientApp: ClientApp): FirebaseCredentials {
  if (clientApp === "mycove") {
    return {
      clientEmail: Env.MYCOVE_FIREBASE_CLIENT_EMAIL,
      privateKey: Env.MYCOVE_FIREBASE_PRIVATE_KEY,
      projectId: Env.MYCOVE_FIREBASE_PROJECT_ID,
    };
  }

  return {
    clientEmail: Env.FIREBASE_CLIENT_EMAIL,
    privateKey: Env.FIREBASE_PRIVATE_KEY,
    projectId: Env.FIREBASE_PROJECT_ID,
  };
}

function requireFirebaseCredentials(
  clientApp: ClientApp,
): Required<FirebaseCredentials> {
  const credentials = getFirebaseCredentials(clientApp);
  const prefix = clientApp === "mycove" ? "MYCOVE_" : "";
  if (!credentials.projectId?.trim()) {
    throw new Error(`${prefix}FIREBASE_PROJECT_ID is not configured`);
  }
  if (!credentials.privateKey?.trim()) {
    throw new Error(`${prefix}FIREBASE_PRIVATE_KEY is not configured`);
  }
  if (!credentials.clientEmail?.trim()) {
    throw new Error(`${prefix}FIREBASE_CLIENT_EMAIL is not configured`);
  }

  return {
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey.replace(/\\n/g, "\n"),
    projectId: credentials.projectId,
  };
}

export function firebaseClient(
  clientApp: ClientApp = "vybaa",
): firebase.app.App {
  const existingApp = firebaseApps.get(clientApp);
  if (existingApp) return existingApp;

  const credentials = requireFirebaseCredentials(clientApp);
  const app = firebase.initializeApp(
    { credential: firebase.credential.cert(credentials) },
    `firebase-${clientApp}`,
  );
  firebaseApps.set(clientApp, app);
  return app;
}
