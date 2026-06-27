import nextCoreWebVitals from 'eslint-config-next/core-web-vitals.js';
import nextTypescript from 'eslint-config-next/typescript.js';

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript];

export default eslintConfig;