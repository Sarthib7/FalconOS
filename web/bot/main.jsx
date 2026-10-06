import React from 'react';
import { createRoot } from 'react-dom/client';
import '../dashboard/style.css';
import './style.css';
import App from './App.jsx';
import OAuthApproval from './OAuthApproval.jsx';
import { takeOAuthApprovalRequest } from './oauth-approval-flow.mjs';

const isOAuthApproval = window.location.pathname.replace(/\/+$/, '') === '/oauth/approve';
if (isOAuthApproval) document.title = 'Falcon · Approve MCP access';
const initialRequest = isOAuthApproval ? takeOAuthApprovalRequest(window.location, window.history) : null;
const Page = isOAuthApproval ? OAuthApproval : App;
createRoot(document.getElementById('root')).render(<React.StrictMode><Page initialRequest={initialRequest} /></React.StrictMode>);
