// Event policy only. Device delivery and deferred notifications belong to input.
export function shouldCancel({monitoring, emitting, keyPress}) {
  return monitoring && !emitting && keyPress;
}

export function cancel(typing) {
  if (!typing || typing.cancelled)
    return false;
  typing.cancelled = true;
  return true;
}
