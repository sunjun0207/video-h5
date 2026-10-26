type Props = {
  text: string
}

export function Pending({ text }: Props) {
  return (
    <div className="pending" role="status">
      <div className="pending-orb" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p>{text}</p>
    </div>
  )
}
