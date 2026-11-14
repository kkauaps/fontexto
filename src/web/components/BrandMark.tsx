import mark from '../assets/fontexto-mark.svg';

export function BrandMark({ wordmark = true, title }: { wordmark?: boolean; title?: string }) {
  return (
    <span className="lp-brand">
      <span className="fx-mark-tile" aria-hidden="true">
        <img src={mark} alt="" />
      </span>
      {wordmark ? <span className="wordmark">{title ?? 'fontexto'}</span> : null}
    </span>
  );
}
