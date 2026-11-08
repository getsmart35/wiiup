import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../styles.css';
import './bidding.css';
import { BiddingDemo } from './BiddingDemo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BiddingDemo />
  </StrictMode>,
);
