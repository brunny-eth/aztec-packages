#include "./secp256r1.hpp"

namespace secp256r1 {
namespace {

constexpr size_t max_num_generators = 1 << 10;
// NOLINTNEXTLINE TODO(@zac-williamson) #1806 get rid of need for these static variables in Pedersen refactor!
static std::array<g1::affine_element, max_num_generators> generators;
// NOLINTNEXTLINE TODO(@zac-williamson) #1806 get rid of need for these static variables in Pedersen refactor!
static bool init_generators = false;

} // namespace

/* In case where prime bit length is 256, the method produces a generator, but only with one less bit of randomness than
the maximum possible, as the y coordinate in that case is determined by the x-coordinate. */
// TODO(@zac-wiliamson #2341 remove this method once we migrate to new hash standard (derive_generators_secure is
// curve-agnostic)
g1::affine_element get_generator(const size_t generator_index)
{
    if (!init_generators) {
        generators = g1::derive_generators<max_num_generators>();
        init_generators = true;
    }
    ASSERT(generator_index < max_num_generators);
    return generators[generator_index];
}
} // namespace secp256r1