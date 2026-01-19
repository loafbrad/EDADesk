# Vector XOR Sieve - XORs two vector (multi-bit) signals
#
# This sieve XORs two vector signals of the same width.
# Edit SIGNAL_A and SIGNAL_B to match your signal names.

SIGNAL_A = 'DATA'
SIGNAL_B = 'MASK'

def run(signals, add_transaction, add_region, modify_signal, create_signal):
    sig_a = signals.get(SIGNAL_A)
    sig_b = signals.get(SIGNAL_B)

    if not sig_a:
        print(f"Signal '{SIGNAL_A}' not found")
        return
    if not sig_b:
        print(f"Signal '{SIGNAL_B}' not found")
        return

    # Check widths match
    if sig_a.width != sig_b.width:
        print(f"Signal widths don't match: {SIGNAL_A}={sig_a.width}, {SIGNAL_B}={sig_b.width}")
        return

    width = sig_a.width

    # Collect all transition times
    times = set()
    for p in sig_a.points:
        times.add(p['x'])
    for p in sig_b.points:
        times.add(p['x'])

    sorted_times = sorted(times)

    # Generate XOR output
    xor_points = []
    for t in sorted_times:
        val_a = sig_a.value_at(t) or 0
        val_b = sig_b.value_at(t) or 0
        xor_points.append({'x': t, 'level': val_a ^ val_b})

    # Create the derived signal with same width
    create_signal(
        name=f'{SIGNAL_A}_XOR_{SIGNAL_B}',
        width=width,
        points=xor_points,
        display_format='hex',
        color='#9C27B0',  # Purple
        source_signals=[SIGNAL_A, SIGNAL_B]
    )
