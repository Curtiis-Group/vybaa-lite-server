import firebase from "firebase-admin";
import { Env } from "../utils/env.util";

let firebaseApp: firebase.app.App | null = null;

export const firebaseClient = () => {
  if (!firebaseApp) {
    const projectId = Env.FIREBASE_PROJECT_ID || "streekapp-1";
    const privateKey = Env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const clientEmail = Env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-1dtb8@streekapp-1.iam.gserviceaccount.com";

    if (!privateKey) {
      throw new Error("FIREBASE_PRIVATE_KEY is not configured");
    }

    firebaseApp = firebase.initializeApp({
      credential: firebase.credential.cert({
        projectId,
        privateKey,
        clientEmail,
      }),
    }, `firebase-${Date.now()}`);
  }

  return firebaseApp;
};
