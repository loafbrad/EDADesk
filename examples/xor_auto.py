# Auto XOR Sieve - Automatically XORs the first two single-bit signals
#
# This sieve finds the first two single-bit signals in the viewer
# and creates a derived XOR signal from them.

def run(signals, add_transaction, add_region, modify_signal, create_signal):
    # Find all single-bit signals
    single_bit_signals = [
        (name, sig) for name, sig in signals.items()
        if sig.width == 1
    ]

    if len(single_bit_signals) < 2:
        print(f"Need at least 2 single-bit signals, found {len(single_bit_signals)}")
        return

    # Use the first two
    name_a, sig_a = single_bit_signals[0]
    name_b, sig_b = single_bit_signals[1]

    print(f"XOR'ing {name_a} with {name_b}")

    # Collect all transition times from both signals
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

    # Create the derived signal
    create_signal(
        name=f'DATA',
        width=1,
        points=xor_points,
        display_format='binary',
        color='#E91E63',
        source_signals=[name_a, name_b]
    )
