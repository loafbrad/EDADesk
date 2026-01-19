# XOR Sieve - Creates a new signal by XOR'ing two signals
#
# This sieve demonstrates the create_signal() capability.
# It takes two single-bit signals and creates a derived signal
# that is their XOR (exclusive or).
#
# Usage: Load this sieve after loading a VCD file with at least
# two single-bit signals. Edit SIGNAL_A and SIGNAL_B below to
# match your signal names.

# Configure which signals to XOR
SIGNAL_A = 'CLK'
SIGNAL_B = 'DATA'

def run(signals, add_transaction, add_region, modify_signal, create_signal):
    # Get the two signals to XOR
    sig_a = signals.get(SIGNAL_A)
    sig_b = signals.get(SIGNAL_B)

    if not sig_a:
        print(f"Signal '{SIGNAL_A}' not found")
        return
    if not sig_b:
        print(f"Signal '{SIGNAL_B}' not found")
        return

    # Only works with single-bit signals
    if sig_a.width != 1 or sig_b.width != 1:
        print("XOR sieve only works with single-bit signals")
        return

    # Collect all transition times from both signals
    times = set()
    for p in sig_a.points:
        times.add(p['x'])
    for p in sig_b.points:
        times.add(p['x'])

    # Sort the times
    sorted_times = sorted(times)

    # Generate XOR output at each transition point
    xor_points = []
    for t in sorted_times:
        val_a = sig_a.value_at(t)
        val_b = sig_b.value_at(t)

        # Handle None values (before first transition)
        if val_a is None:
            val_a = 0
        if val_b is None:
            val_b = 0

        # XOR the values
        xor_val = val_a ^ val_b
        xor_points.append({'x': t, 'level': xor_val})

    # Create the derived XOR signal
    create_signal(
        name=f'{SIGNAL_A}_XOR_{SIGNAL_B}',
        width=1,
        points=xor_points,
        display_format='binary',
        color='#E91E63'  # Pink color
    )

    # Also highlight regions where XOR is high
    i = 0
    while i < len(xor_points):
        if xor_points[i]['level'] == 1:
            # Find the end of this high region
            start_x = xor_points[i]['x']
            end_x = xor_points[i + 1]['x'] if i + 1 < len(xor_points) else start_x + 1

            add_region(
                start_x,
                end_x,
                'rgba(233, 30, 99, 0.2)',  # Light pink
                f'{SIGNAL_A}_XOR_{SIGNAL_B}',
                'XOR=1'
            )
        i += 1
